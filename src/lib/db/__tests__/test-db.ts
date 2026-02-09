/**
 * Shared test database helper.
 *
 * Creates a temporary SQLite database with the full Castle schema
 * and overrides globalThis singletons so all code that calls getDb()
 * (including API route handlers) uses the test DB instead of production.
 *
 * Usage:
 *   const { db, sqlite, cleanup } = installTestDb();
 *   afterAll(() => cleanup());
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as schema from "../schema";

// Full schema SQL matching src/lib/db/index.ts TABLE_SQL
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
    total_output_tokens INTEGER DEFAULT 0,
    compaction_boundary_message_id TEXT
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
  CREATE TABLE IF NOT EXISTS recent_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
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

const FTS5_SQL = `
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

/**
 * Create a fresh test database in a temp directory.
 * Returns the Drizzle instance, raw SQLite instance, and path.
 */
export function createTestDb() {
  const tmpDir = mkdtempSync(join(tmpdir(), "castle-test-"));
  const dbPath = join(tmpDir, "test.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(TABLE_SQL);
  sqlite.exec(FTS5_SQL);
  return { db: drizzle(sqlite, { schema }), sqlite, dbPath, tmpDir };
}

/**
 * Install a test database into globalThis so getDb() uses it.
 * Returns a cleanup function that restores the original globals.
 *
 * Call in beforeAll(), and call cleanup() in afterAll().
 */
export function installTestDb() {
  const { db, sqlite, dbPath, tmpDir } = createTestDb();

  const g = globalThis as Record<string, unknown>;
  const originalDb = g["__castle_db__"];
  const originalSqlite = g["__castle_sqlite__"];
  const originalMigrated = g["__castle_db_migrated__"];

  g["__castle_db__"] = db;
  g["__castle_sqlite__"] = sqlite;
  g["__castle_db_migrated__"] = 999; // skip migration check

  const cleanup = () => {
    sqlite.close();
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }

    g["__castle_db__"] = originalDb;
    g["__castle_sqlite__"] = originalSqlite;
    g["__castle_db_migrated__"] = originalMigrated;
  };

  return { db, sqlite, dbPath, tmpDir, cleanup };
}
