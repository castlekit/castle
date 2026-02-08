import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { join } from "path";
import { existsSync, mkdirSync, chmodSync } from "fs";
import { platform } from "os";
import { getCastleDir } from "@/lib/config";
import * as schema from "./schema";

// ============================================================================
// Singleton
// ============================================================================

const DB_KEY = "__castle_db__" as const;

interface GlobalWithDb {
  [DB_KEY]?: ReturnType<typeof drizzle>;
}

function getGlobalDb(): ReturnType<typeof drizzle> | undefined {
  return (globalThis as unknown as GlobalWithDb)[DB_KEY];
}

function setGlobalDb(db: ReturnType<typeof drizzle>): void {
  (globalThis as unknown as GlobalWithDb)[DB_KEY] = db;
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
  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    default_agent_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
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
// Initialize
// ============================================================================

function createDb(): ReturnType<typeof drizzle> {
  const dataDir = join(getCastleDir(), "data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  }

  const dbPath = join(dataDir, "castle.db");
  const isNew = !existsSync(dbPath);

  const sqlite = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // Create tables (idempotent)
  sqlite.exec(TABLE_SQL);

  // Create FTS5 virtual table and triggers (only if they don't already exist)
  sqlite.exec(FTS5_CREATE);

  // If FTS5 is empty but messages exist (e.g. after a previous broken drop/recreate),
  // repopulate the FTS5 index from the messages table.
  const ftsCount = sqlite.prepare("SELECT COUNT(*) as c FROM messages_fts").get() as { c: number };
  const msgCount = sqlite.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number };
  if (ftsCount.c === 0 && msgCount.c > 0) {
    console.log(`[Castle DB] Repopulating FTS5 index for ${msgCount.c} messages...`);
    sqlite.exec("INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages");
  }

  // Secure file permissions on creation
  if (isNew && platform() !== "win32") {
    try {
      chmodSync(dbPath, 0o600);
    } catch {
      // May fail on some filesystems
    }
  }

  console.log(`[Castle DB] ${isNew ? "Created" : "Opened"} database at ${dbPath}`);

  return drizzle(sqlite, { schema });
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Get the Castle database instance (Drizzle ORM).
 * Uses globalThis singleton to persist across Next.js HMR in dev mode.
 */
export function getDb() {
  let db = getGlobalDb();
  if (!db) {
    db = createDb();
    setGlobalDb(db);
  }
  return db;
}

/**
 * Get the path to the SQLite database file.
 */
export function getDbPath(): string {
  return join(getCastleDir(), "data", "castle.db");
}
