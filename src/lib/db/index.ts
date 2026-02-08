import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { join } from "path";
import {
  existsSync,
  mkdirSync,
  chmodSync,
  copyFileSync,
  readdirSync,
  unlinkSync,
  statSync,
} from "fs";
import { platform } from "os";
import { getCastleDir } from "@/lib/config";
import * as schema from "./schema";

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of backup files to keep */
const MAX_BACKUPS = 5;

/** How often to checkpoint WAL (ms) — every 5 minutes */
const CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;

/** Current schema version — bump when adding new migrations */
const SCHEMA_VERSION = 4;

// ============================================================================
// Singleton
// ============================================================================

const DB_KEY = "__castle_db__" as const;
const SQLITE_KEY = "__castle_sqlite__" as const;
const DB_MIGRATED_KEY = "__castle_db_migrated__" as const;
const CHECKPOINT_TIMER_KEY = "__castle_checkpoint_timer__" as const;
const SHUTDOWN_REGISTERED_KEY = "__castle_shutdown_registered__" as const;

interface GlobalWithDb {
  [DB_KEY]?: ReturnType<typeof drizzle>;
  [SQLITE_KEY]?: InstanceType<typeof Database>;
  [DB_MIGRATED_KEY]?: number;
  [CHECKPOINT_TIMER_KEY]?: ReturnType<typeof setInterval>;
  [SHUTDOWN_REGISTERED_KEY]?: boolean;
}

function getGlobalDb(): ReturnType<typeof drizzle> | undefined {
  return (globalThis as unknown as GlobalWithDb)[DB_KEY];
}

function getGlobalSqlite(): InstanceType<typeof Database> | undefined {
  return (globalThis as unknown as GlobalWithDb)[SQLITE_KEY];
}

function setGlobals(
  db: ReturnType<typeof drizzle>,
  sqlite: InstanceType<typeof Database>
): void {
  (globalThis as unknown as GlobalWithDb)[DB_KEY] = db;
  (globalThis as unknown as GlobalWithDb)[SQLITE_KEY] = sqlite;
}

function getMigratedVersion(): number {
  return (globalThis as unknown as GlobalWithDb)[DB_MIGRATED_KEY] ?? 0;
}

function setMigratedVersion(v: number): void {
  (globalThis as unknown as GlobalWithDb)[DB_MIGRATED_KEY] = v;
}

function getCheckpointTimer(): ReturnType<typeof setInterval> | undefined {
  return (globalThis as unknown as GlobalWithDb)[CHECKPOINT_TIMER_KEY];
}

function setCheckpointTimer(timer: ReturnType<typeof setInterval>): void {
  (globalThis as unknown as GlobalWithDb)[CHECKPOINT_TIMER_KEY] = timer;
}

function isShutdownRegistered(): boolean {
  return (globalThis as unknown as GlobalWithDb)[SHUTDOWN_REGISTERED_KEY] ?? false;
}

function setShutdownRegistered(): void {
  (globalThis as unknown as GlobalWithDb)[SHUTDOWN_REGISTERED_KEY] = true;
}

// ============================================================================
// Backup & Recovery
// ============================================================================

/**
 * Create a timestamped backup of the database file.
 * Rotates old backups to keep only MAX_BACKUPS.
 * Returns the backup path on success, null on failure.
 */
function backupDatabase(dbPath: string, reason: string): string | null {
  if (!existsSync(dbPath)) return null;

  try {
    const backupDir = join(getCastleDir(), "data", "backups");
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(backupDir, `castle-${timestamp}.db`);

    copyFileSync(dbPath, backupPath);

    // Also copy WAL if it exists (contains uncommitted data)
    const walPath = `${dbPath}-wal`;
    if (existsSync(walPath)) {
      copyFileSync(walPath, `${backupPath}-wal`);
    }

    console.log(`[Castle DB] Backup created (${reason}): ${backupPath}`);

    // Rotate old backups
    rotateBackups(backupDir);

    return backupPath;
  } catch (err) {
    console.error(`[Castle DB] Backup failed (${reason}):`, (err as Error).message);
    return null;
  }
}

/**
 * Keep only the newest MAX_BACKUPS backup files. Deletes oldest first.
 */
function rotateBackups(backupDir: string): void {
  try {
    const files = readdirSync(backupDir)
      .filter((f) => f.startsWith("castle-") && f.endsWith(".db"))
      .map((f) => ({
        name: f,
        path: join(backupDir, f),
        mtime: statSync(join(backupDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime); // newest first

    // Remove excess backups (and their WAL files)
    for (const file of files.slice(MAX_BACKUPS)) {
      try {
        unlinkSync(file.path);
        const wal = `${file.path}-wal`;
        if (existsSync(wal)) unlinkSync(wal);
        console.log(`[Castle DB] Rotated old backup: ${file.name}`);
      } catch {
        // non-critical
      }
    }
  } catch {
    // non-critical
  }
}

// ============================================================================
// WAL Checkpoint
// ============================================================================

/**
 * Checkpoint the WAL — flushes all WAL data into the main database file.
 * This is critical for crash safety: data in the WAL but not in the main
 * DB file can be lost if the process is killed with SIGKILL (kill -9).
 *
 * PASSIVE mode: checkpoints without blocking readers/writers.
 * TRUNCATE mode: checkpoints and truncates WAL to zero size (used on shutdown).
 */
function checkpointWal(
  sqlite: InstanceType<typeof Database>,
  mode: "PASSIVE" | "TRUNCATE" = "PASSIVE"
): void {
  try {
    const result = sqlite.pragma(`wal_checkpoint(${mode})`) as {
      busy: number;
      checkpointed: number;
      log: number;
    }[];
    if (result?.[0]) {
      const { busy, checkpointed, log } = result[0];
      if (log > 0) {
        console.log(
          `[Castle DB] WAL checkpoint (${mode}): ${checkpointed}/${log} pages flushed${
            busy ? " (some pages busy)" : ""
          }`
        );
      }
    }
  } catch (err) {
    console.error("[Castle DB] WAL checkpoint failed:", (err as Error).message);
  }
}

/**
 * Start periodic WAL checkpoints. The WAL is the main risk surface for
 * data loss on crash — periodic checkpoints minimize how much unflushed
 * data can be lost.
 */
function startPeriodicCheckpoint(sqlite: InstanceType<typeof Database>): void {
  // Don't double-register
  const existing = getCheckpointTimer();
  if (existing) return;

  const timer = setInterval(() => {
    try {
      if (sqlite.open) {
        checkpointWal(sqlite, "PASSIVE");
      }
    } catch {
      // DB might have been closed
    }
  }, CHECKPOINT_INTERVAL_MS);

  // Don't prevent Node from exiting
  if (timer.unref) timer.unref();
  setCheckpointTimer(timer);
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

/**
 * Register process signal handlers to checkpoint WAL before exit.
 * This ensures data is flushed to the main DB file on clean shutdown.
 * Note: SIGKILL (kill -9) cannot be caught — that's why we also
 * checkpoint periodically and on startup.
 */
function registerShutdownHandlers(sqlite: InstanceType<typeof Database>): void {
  if (isShutdownRegistered()) return;
  setShutdownRegistered();

  const shutdown = (signal: string) => {
    console.log(`[Castle DB] ${signal} received — checkpointing WAL...`);
    try {
      if (sqlite.open) {
        checkpointWal(sqlite, "TRUNCATE");
        sqlite.close();
        console.log("[Castle DB] Database closed cleanly");
      }
    } catch (err) {
      console.error("[Castle DB] Shutdown checkpoint failed:", (err as Error).message);
    }
  };

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    shutdown("SIGINT");
    process.exit(0);
  });

  // beforeExit fires when the event loop is empty (clean exit)
  process.on("beforeExit", () => {
    shutdown("beforeExit");
  });
}

// ============================================================================
// Integrity Check
// ============================================================================

/**
 * Run a quick integrity check on the database.
 * Returns true if the DB passes, false if corrupted.
 */
function checkIntegrity(sqlite: InstanceType<typeof Database>): boolean {
  try {
    const result = sqlite.pragma("quick_check") as { quick_check: string }[];
    const ok = result?.[0]?.quick_check === "ok";
    if (!ok) {
      console.error(
        "[Castle DB] INTEGRITY CHECK FAILED:",
        result?.map((r) => r.quick_check).join(", ")
      );
    }
    return ok;
  } catch (err) {
    console.error("[Castle DB] Integrity check error:", (err as Error).message);
    return false;
  }
}

// ============================================================================
// FTS5 virtual table SQL (run raw — Drizzle doesn't support virtual tables)
// ============================================================================

// FTS5 setup: standalone table (not external content) synced via triggers.
// IMPORTANT: Do NOT drop/recreate on every startup — that causes "SQL logic error"
// when triggers try to delete old FTS5 entries that no longer exist after the drop.
const FTS5_CREATE = `
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
  USING fts5(content, tokenize='unicode61');

  CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
  END;

  CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
  END;

  CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
    INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
  END;
`;

// ============================================================================
// Schema creation SQL (generated from Drizzle schema)
// We use push-based migration — creates tables if they don't exist.
// ============================================================================

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    default_agent_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER,
    last_accessed_at INTEGER,
    archived_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS agent_statuses (
    agent_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'idle',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channel_agents (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    PRIMARY KEY (channel_id, agent_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    session_key TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    summary TEXT,
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_channel ON sessions(channel_id, started_at);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES sessions(id),
    sender_type TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT,
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'complete',
    mentioned_agent_id TEXT,
    run_id TEXT,
    session_key TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_run_id ON messages(run_id);

  CREATE TABLE IF NOT EXISTS message_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    attachment_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT,
    file_size INTEGER,
    original_name TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_message ON message_attachments(message_id);

  CREATE TABLE IF NOT EXISTS message_reactions (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    agent_id TEXT,
    emoji TEXT NOT NULL,
    emoji_char TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
`;

// ============================================================================
// Migrations
// ============================================================================

/**
 * Run idempotent schema migrations against the raw SQLite connection.
 * Creates a backup before running any migration.
 * Tracked via a globalThis version flag so they only run once per process,
 * but also runs when code changes during HMR bump the version.
 */
function runMigrations(
  sqlite: InstanceType<typeof Database>,
  dbPath: string
): void {
  if (getMigratedVersion() >= SCHEMA_VERSION) return;

  // Back up before any migration
  backupDatabase(dbPath, `pre-migration-v${SCHEMA_VERSION}`);

  // --- Migration 1: Add last_accessed_at column to channels ---
  const channelCols = sqlite.prepare("PRAGMA table_info(channels)").all() as {
    name: string;
  }[];
  if (!channelCols.some((c) => c.name === "last_accessed_at")) {
    console.log("[Castle DB] Migration: adding last_accessed_at to channels");
    sqlite.exec("ALTER TABLE channels ADD COLUMN last_accessed_at INTEGER");
  }

  // --- Migration 2: Create settings table ---
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
    .get() as { name: string } | undefined;
  if (!tables) {
    console.log("[Castle DB] Migration: creating settings table");
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  // --- Migration 3: Add archived_at column to channels ---
  const channelColsV3 = sqlite.prepare("PRAGMA table_info(channels)").all() as {
    name: string;
  }[];
  if (!channelColsV3.some((c) => c.name === "archived_at")) {
    console.log("[Castle DB] Migration: adding archived_at to channels");
    sqlite.exec("ALTER TABLE channels ADD COLUMN archived_at INTEGER");
  }

  // --- Migration 4: Create agent_statuses table ---
  const agentStatusTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_statuses'")
    .get() as { name: string } | undefined;
  if (!agentStatusTable) {
    console.log("[Castle DB] Migration: creating agent_statuses table");
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS agent_statuses (
        agent_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'idle',
        updated_at INTEGER NOT NULL
      )
    `);
  }

  // Checkpoint after migration to persist changes to main DB file immediately
  checkpointWal(sqlite, "TRUNCATE");

  setMigratedVersion(SCHEMA_VERSION);
  console.log(`[Castle DB] Migrations complete (schema v${SCHEMA_VERSION})`);
}

// ============================================================================
// Initialize
// ============================================================================

function createDb(): {
  db: ReturnType<typeof drizzle>;
  sqlite: InstanceType<typeof Database>;
} {
  const dataDir = join(getCastleDir(), "data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  }

  const dbPath = join(dataDir, "castle.db");
  const isNew = !existsSync(dbPath);

  // Back up existing DB on every fresh open (process start / HMR reload)
  if (!isNew) {
    backupDatabase(dbPath, "startup");
  }

  const sqlite = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // ----- Integrity check on existing databases -----
  if (!isNew) {
    const ok = checkIntegrity(sqlite);
    if (!ok) {
      console.error(
        "[Castle DB] WARNING: Database integrity check failed! " +
          "Data may be corrupted. A backup was created above."
      );
      // Continue anyway — SQLite can often still read valid rows
    }
  }

  // ----- Checkpoint any stale WAL from a previous crash -----
  // This is critical: if the previous process was killed, the WAL may
  // contain data that hasn't been written to the main DB file.
  // Checkpointing now ensures it's flushed before we proceed.
  if (!isNew) {
    checkpointWal(sqlite, "TRUNCATE");
  }

  // Create tables (idempotent)
  sqlite.exec(TABLE_SQL);

  // Create FTS5 virtual table and triggers (only if they don't already exist)
  sqlite.exec(FTS5_CREATE);

  // If FTS5 is empty but messages exist (e.g. after a previous broken drop/recreate),
  // repopulate the FTS5 index from the messages table.
  const ftsCount = sqlite.prepare(
    "SELECT COUNT(*) as c FROM messages_fts"
  ).get() as { c: number };
  const msgCount = sqlite.prepare(
    "SELECT COUNT(*) as c FROM messages"
  ).get() as { c: number };
  if (ftsCount.c === 0 && msgCount.c > 0) {
    console.log(
      `[Castle DB] Repopulating FTS5 index for ${msgCount.c} messages...`
    );
    sqlite.exec(
      "INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages"
    );
  }

  // Checkpoint after all schema setup to flush everything to main file
  checkpointWal(sqlite, "TRUNCATE");

  // Secure file permissions on creation
  if (isNew && platform() !== "win32") {
    try {
      chmodSync(dbPath, 0o600);
    } catch {
      // May fail on some filesystems
    }
  }

  // ----- Safety infrastructure -----
  // Start periodic WAL checkpoints (every 5 minutes)
  startPeriodicCheckpoint(sqlite);

  // Register graceful shutdown handlers (SIGTERM, SIGINT, beforeExit)
  registerShutdownHandlers(sqlite);

  const stats = !isNew
    ? ` (${msgCount.c} messages, ${
        (
          sqlite.prepare("SELECT COUNT(*) as c FROM channels").get() as {
            c: number;
          }
        ).c
      } channels)`
    : "";

  console.log(
    `[Castle DB] ${isNew ? "Created" : "Opened"} database at ${dbPath}${stats}`
  );

  return { db: drizzle(sqlite, { schema }), sqlite };
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Get the Castle database instance (Drizzle ORM).
 * Uses globalThis singleton to persist across Next.js HMR in dev mode.
 * Migrations always run if schema version has changed.
 */
export function getDb() {
  let db = getGlobalDb();
  let sqlite = getGlobalSqlite();

  if (!db || !sqlite) {
    const created = createDb();
    db = created.db;
    sqlite = created.sqlite;
    setGlobals(db, sqlite);
  }

  // Always ensure migrations have run (even if singleton was cached from before code change)
  const dbPath = join(getCastleDir(), "data", "castle.db");
  runMigrations(sqlite, dbPath);

  return db;
}

/**
 * Get the path to the SQLite database file.
 */
export function getDbPath(): string {
  return join(getCastleDir(), "data", "castle.db");
}
