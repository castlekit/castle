import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as schema from "../schema";

// ============================================================================
// Test-specific DB setup (in-memory or temp file)
// ============================================================================

let tmpDir: string;

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
  CREATE TABLE IF NOT EXISTS message_reactions (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    agent_id TEXT,
    emoji TEXT NOT NULL,
    emoji_char TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
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

function createTestDb() {
  tmpDir = mkdtempSync(join(tmpdir(), "castle-test-"));
  const dbPath = join(tmpDir, "test.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(TABLE_SQL);
  sqlite.exec(FTS5_SQL);
  return { db: drizzle(sqlite, { schema }), sqlite, dbPath };
}

// ============================================================================
// Tests
// ============================================================================

describe("Database Queries", () => {
  let db: ReturnType<typeof drizzle>;
  let sqlite: Database.Database;

  beforeAll(() => {
    const setup = createTestDb();
    db = setup.db;
    sqlite = setup.sqlite;

    // Override the global DB for our query functions
    const DB_KEY = "__castle_db__";
    (globalThis as Record<string, unknown>)[DB_KEY] = db;
  });

  afterAll(() => {
    sqlite.close();
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  // ---- Channels ----

  describe("Channels", () => {
    it("should create and retrieve a channel", async () => {
      const { createChannel, getChannel, getChannels } = await import("../queries");

      const channel = createChannel("Test Channel", "agent-1", ["agent-1", "agent-2"]);
      expect(channel.name).toBe("Test Channel");
      expect(channel.defaultAgentId).toBe("agent-1");
      expect(channel.agents).toContain("agent-1");
      expect(channel.agents).toContain("agent-2");

      const fetched = getChannel(channel.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe("Test Channel");

      const all = getChannels();
      expect(all.length).toBeGreaterThanOrEqual(1);
    });

    it("should update a channel name", async () => {
      const { createChannel, updateChannel, getChannel } = await import("../queries");

      const channel = createChannel("Original", "agent-1");
      updateChannel(channel.id, { name: "Updated" });

      const fetched = getChannel(channel.id);
      expect(fetched!.name).toBe("Updated");
    });

    it("should delete a channel", async () => {
      const { createChannel, deleteChannel, getChannel } = await import("../queries");

      const channel = createChannel("To Delete", "agent-1");
      const deleted = deleteChannel(channel.id);
      expect(deleted).toBe(true);

      const fetched = getChannel(channel.id);
      expect(fetched).toBeNull();
    });
  });

  // ---- Messages ----

  describe("Messages", () => {
    it("should create and retrieve messages", async () => {
      const { createChannel, createMessage, getMessagesByChannel } = await import("../queries");

      const channel = createChannel("Msg Test", "agent-1");

      createMessage({
        channelId: channel.id,
        senderType: "user",
        senderId: "local-user",
        senderName: "You",
        content: "Hello there",
      });

      createMessage({
        channelId: channel.id,
        senderType: "agent",
        senderId: "agent-1",
        senderName: "Agent",
        content: "Hi! How can I help?",
      });

      const messages = getMessagesByChannel(channel.id);
      expect(messages.length).toBe(2);
      expect(messages[0].content).toBe("Hello there");
      expect(messages[1].content).toBe("Hi! How can I help?");
    });

    it("should support pagination with before cursor", async () => {
      const { createChannel, createMessage, getMessagesByChannel } = await import("../queries");

      const channel = createChannel("Pagination Test", "agent-1");

      // Create 5 messages with slight time gaps
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const msg = createMessage({
          channelId: channel.id,
          senderType: "user",
          senderId: "local-user",
          content: `Message ${i}`,
        });
        ids.push(msg.id);
        // Small delay to ensure different timestamps
        await new Promise((r) => setTimeout(r, 10));
      }

      // Get latest 3
      const latest = getMessagesByChannel(channel.id, 3);
      expect(latest.length).toBe(3);

      // Get messages before the oldest of the latest
      const older = getMessagesByChannel(channel.id, 3, latest[0].id);
      expect(older.length).toBe(2);
    });

    it("should update message status", async () => {
      const { createChannel, createMessage, updateMessage, getMessagesByChannel } = await import("../queries");

      const channel = createChannel("Status Test", "agent-1");
      const msg = createMessage({
        channelId: channel.id,
        senderType: "agent",
        senderId: "agent-1",
        content: "Partial response...",
        status: "complete",
      });

      updateMessage(msg.id, { status: "interrupted" });

      const messages = getMessagesByChannel(channel.id);
      expect(messages[0].status).toBe("interrupted");
    });
  });

  // ---- Search (FTS5) ----

  describe("Search (FTS5)", () => {
    it("should find messages by content", async () => {
      const { createChannel, createMessage, searchMessages } = await import("../queries");

      const channel = createChannel("Search Test", "agent-1");

      createMessage({
        channelId: channel.id,
        senderType: "user",
        senderId: "local-user",
        content: "The quick brown fox jumps over the lazy dog",
      });

      createMessage({
        channelId: channel.id,
        senderType: "agent",
        senderId: "agent-1",
        content: "Here is some completely different text about cats",
      });

      const results = searchMessages("brown fox");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain("brown fox");

      const noResults = searchMessages("nonexistent_xyz_term");
      expect(noResults.length).toBe(0);
    });

    it("should reject overly long queries", async () => {
      const { searchMessages } = await import("../queries");
      const longQuery = "a".repeat(501);
      const results = searchMessages(longQuery);
      expect(results).toEqual([]);
    });
  });

  // ---- Sessions ----

  describe("Sessions", () => {
    it("should create and retrieve sessions", async () => {
      const { createChannel, createSession, getSessionsByChannel, getLatestSessionKey } = await import("../queries");

      const channel = createChannel("Session Test", "agent-1");

      const session = createSession({
        channelId: channel.id,
        sessionKey: "sk_test_123",
      });

      expect(session.sessionKey).toBe("sk_test_123");

      const sessions = getSessionsByChannel(channel.id);
      expect(sessions.length).toBe(1);

      const key = getLatestSessionKey(channel.id);
      expect(key).toBe("sk_test_123");
    });
  });

  // ---- Storage Stats ----

  describe("Storage Stats", () => {
    it("should return correct counts", async () => {
      const { getStorageStats } = await import("../queries");

      const stats = getStorageStats();
      expect(stats.messages).toBeGreaterThan(0);
      expect(stats.channels).toBeGreaterThan(0);
      expect(typeof stats.totalAttachmentBytes).toBe("number");
    });
  });
});
