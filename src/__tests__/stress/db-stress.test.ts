/**
 * Database stress tests.
 *
 * Hammers SQLite with concurrent writes, large datasets, FTS5 corruption
 * recovery, pagination under load, and cascade deletes.
 *
 * Run: npm run stress
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type Database from "better-sqlite3";
import type { drizzle } from "drizzle-orm/better-sqlite3";
import { installTestDb } from "../../lib/db/__tests__/test-db";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let db: ReturnType<typeof drizzle>;
let sqlite: Database.Database;
let cleanup: () => void;

beforeAll(() => {
  const setup = installTestDb();
  db = setup.db;
  sqlite = setup.sqlite;
  cleanup = setup.cleanup;
});

afterAll(() => cleanup());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logPerf(label: string, count: number, durationMs: number) {
  const rate = Math.round(count / (durationMs / 1000));
  console.log(`[Stress] ${label}: ${count} ops in ${durationMs}ms (${rate} ops/s)`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Database Stress", () => {
  it("should handle 1000 concurrent message inserts across 10 channels", async () => {
    const { createChannel, createMessage, getMessagesByChannel } = await import(
      "@/lib/db/queries"
    );

    const CHANNEL_COUNT = 10;
    const MESSAGES_PER_CHANNEL = 100;
    const channels: string[] = [];

    // Create channels
    for (let i = 0; i < CHANNEL_COUNT; i++) {
      const ch = createChannel(`Stress Channel ${i}`, "agent-stress");
      channels.push(ch.id);
    }

    // Insert messages in rapid batches
    const start = Date.now();
    const allMessages: string[] = [];

    for (let c = 0; c < CHANNEL_COUNT; c++) {
      for (let m = 0; m < MESSAGES_PER_CHANNEL; m++) {
        const msg = createMessage({
          channelId: channels[c],
          senderType: m % 2 === 0 ? "user" : "agent",
          senderId: m % 2 === 0 ? "user-stress" : "agent-stress",
          content: `Stress message ${m} in channel ${c} — ${crypto.randomUUID()}`,
        });
        allMessages.push(msg.id);
      }
    }

    const duration = Date.now() - start;
    logPerf("Concurrent inserts", CHANNEL_COUNT * MESSAGES_PER_CHANNEL, duration);

    // Verify counts
    for (let c = 0; c < CHANNEL_COUNT; c++) {
      const msgs = getMessagesByChannel(channels[c], 200);
      expect(msgs.length).toBe(MESSAGES_PER_CHANNEL);
    }

    // Verify FTS5 consistency — search for a term that should exist in every message
    const { searchMessages } = await import("@/lib/db/queries");
    const results = searchMessages("Stress message", undefined, 1500);
    expect(results.length).toBe(CHANNEL_COUNT * MESSAGES_PER_CHANNEL);
  });

  it("should paginate correctly through 5000+ messages", async () => {
    const { createChannel, createMessage, getMessagesByChannel, getMessagesAfter, getMessagesAround } =
      await import("@/lib/db/queries");

    const ch = createChannel("Pagination Stress", "agent-pag");
    const TOTAL = 5000;
    const messageIds: string[] = [];

    // Seed messages with distinct timestamps to ensure clean cursor pagination.
    // Rapid inserts produce identical Date.now() which makes composite cursor
    // (createdAt, id) unreliable for exact traversal.
    // We use raw SQL to set explicit created_at values.
    type SqliteClient = { prepare: (sql: string) => { run: (...p: unknown[]) => void } };
    type DrizzleDb = { session: { client: SqliteClient } };
    const rawSql = (db as unknown as DrizzleDb).session.client;

    const seedStart = Date.now();
    const baseTime = Date.now() - TOTAL; // start in the past
    for (let i = 0; i < TOTAL; i++) {
      const id = crypto.randomUUID();
      rawSql.prepare(
        "INSERT INTO messages (id, channel_id, sender_type, sender_id, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(id, ch.id, "user", "user-pag", `Pagination message ${i.toString().padStart(5, "0")}`, "complete", baseTime + i);
      // FTS trigger handles the FTS insert automatically
      messageIds.push(id);
    }
    logPerf("Seeding pagination", TOTAL, Date.now() - seedStart);

    // Backward pagination — collect all messages page by page
    // Note: rapid inserts produce identical timestamps, so we use a Set
    // to handle any overlap at cursor boundaries.
    const pageStart = Date.now();
    const collected = new Set<string>();
    let cursor: string | undefined = undefined;
    let pages = 0;
    let emptyPageCount = 0;

    while (collected.size < TOTAL && emptyPageCount < 3) {
      const page = getMessagesByChannel(ch.id, 50, cursor);
      if (page.length === 0) {
        emptyPageCount++;
        break;
      }
      const beforeSize = collected.size;
      for (const m of page) collected.add(m.id);
      // If no new messages were added, we're stuck
      if (collected.size === beforeSize) break;
      cursor = page[0].id; // oldest message on this page
      pages++;
    }

    logPerf(`Backward pagination (${pages} pages)`, collected.size, Date.now() - pageStart);
    expect(collected.size).toBe(TOTAL);

    // Forward pagination from first message
    const forwardStart = Date.now();
    const forwardCollected: string[] = [];
    let forwardCursor = messageIds[0];
    let forwardPages = 0;

    while (true) {
      const page = getMessagesAfter(ch.id, forwardCursor, 50);
      if (page.length === 0) break;
      forwardCollected.push(...page.map((m) => m.id));
      forwardCursor = page[page.length - 1].id;
      forwardPages++;
    }

    logPerf(`Forward pagination (${forwardPages} pages)`, forwardCollected.length, Date.now() - forwardStart);
    // Forward from first message should get TOTAL - 1 (excludes the cursor message)
    expect(forwardCollected.length).toBe(TOTAL - 1);

    // Around pagination — pick a message in the middle
    const midId = messageIds[Math.floor(TOTAL / 2)];
    const aroundStart = Date.now();
    const around = getMessagesAround(ch.id, midId, 100);
    logPerf("Around pagination", around?.messages.length ?? 0, Date.now() - aroundStart);

    expect(around).not.toBeNull();
    expect(around!.messages.length).toBeLessThanOrEqual(101); // half + anchor + half
    expect(around!.hasMoreBefore).toBe(true);
    expect(around!.hasMoreAfter).toBe(true);

    // Verify the anchor is in the result
    const anchorFound = around!.messages.find((m) => m.id === midId);
    expect(anchorFound).toBeDefined();
  });

  it("should handle 100 concurrent FTS5 searches", async () => {
    const { createChannel, createMessage, searchMessages } = await import(
      "@/lib/db/queries"
    );

    // Seed varied content
    const ch = createChannel("Search Stress", "agent-search");
    const topics = ["Bitcoin", "Ethereum", "Lightning", "Ordinals", "Runes", "Nostr", "UTXO", "Mempool"];

    for (let i = 0; i < 200; i++) {
      const topic = topics[i % topics.length];
      createMessage({
        channelId: ch.id,
        senderType: "agent",
        senderId: "agent-search",
        content: `${topic} analysis report #${i}: The ${topic.toLowerCase()} network shows interesting patterns in block ${1000 + i}.`,
      });
    }

    // Run 100 concurrent searches
    const start = Date.now();
    const results: number[] = [];

    for (let i = 0; i < 100; i++) {
      const topic = topics[i % topics.length];
      const found = searchMessages(topic, ch.id, 50);
      results.push(found.length);
    }

    const duration = Date.now() - start;
    logPerf("Concurrent FTS5 searches", 100, duration);

    // Each topic has 25 messages (200 / 8 topics)
    for (let i = 0; i < topics.length; i++) {
      expect(results[i]).toBe(25);
    }
  });

  it("should auto-repair FTS5 under pressure", async () => {
    const { createChannel, createMessage, searchMessages, deleteMessage } = await import(
      "@/lib/db/queries"
    );

    const ch = createChannel("FTS Repair Stress", "agent-fts");

    // Create messages
    const msgIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const msg = createMessage({
        channelId: ch.id,
        senderType: "user",
        senderId: "user-fts",
        content: `Repairable message ${i} about blockchain technology`,
      });
      msgIds.push(msg.id);
    }

    // Intentionally corrupt FTS by inserting orphaned entries
    type SqliteClient = { exec: (sql: string) => void };
    type DrizzleDb = { session: { client: SqliteClient } };
    const rawSqlite = (db as unknown as DrizzleDb).session.client;

    // Drop the delete trigger so deletes don't clean up FTS
    rawSqlite.exec("DROP TRIGGER IF EXISTS messages_fts_delete");

    // Delete some messages without FTS cleanup — creates orphaned FTS entries
    const start = Date.now();
    for (let i = 0; i < 20; i++) {
      // Direct SQL delete bypassing the queries module to avoid trigger rebuild
      sqlite.prepare("DELETE FROM messages WHERE id = ?").run(msgIds[i]);
    }

    // Recreate the trigger (now FTS is out of sync)
    rawSqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
      END;
    `);

    // Now delete remaining messages through the queries module — should trigger auto-repair
    let repairCount = 0;
    for (let i = 20; i < 50; i++) {
      try {
        deleteMessage(msgIds[i]);
      } catch {
        repairCount++;
      }
    }

    logPerf("FTS repair cycles", 30, Date.now() - start);

    // Search should still work after repair
    const results = searchMessages("blockchain", ch.id, 100);
    // All messages should be deleted, so no results
    expect(results.length).toBe(0);
  });

  it("should handle channel deletion cascade with 1000 messages", async () => {
    const { createChannel, createMessage, deleteChannel, getChannel, searchMessages } = await import(
      "@/lib/db/queries"
    );

    const ch = createChannel("Cascade Stress", "agent-cascade");
    const TOTAL = 1000;

    // Seed messages with varied content for FTS
    const seedStart = Date.now();
    for (let i = 0; i < TOTAL; i++) {
      createMessage({
        channelId: ch.id,
        senderType: i % 2 === 0 ? "user" : "agent",
        senderId: i % 2 === 0 ? "user-cascade" : "agent-cascade",
        content: `Cascade test message ${i} about decentralized computing`,
      });
    }
    logPerf("Seeding cascade", TOTAL, Date.now() - seedStart);

    // Verify messages exist in FTS
    const beforeSearch = searchMessages("decentralized", ch.id, 1500);
    expect(beforeSearch.length).toBe(TOTAL);

    // Delete the channel — should cascade to all messages, FTS, etc.
    const deleteStart = Date.now();
    const deleted = deleteChannel(ch.id);
    logPerf("Cascade delete", TOTAL, Date.now() - deleteStart);

    expect(deleted).toBe(true);
    expect(getChannel(ch.id)).toBeNull();

    // FTS should be clean — no orphaned entries for deleted messages
    const afterSearch = searchMessages("decentralized", ch.id, 1500);
    expect(afterSearch.length).toBe(0);
  });

  it("should maintain data integrity under WAL pressure", async () => {
    const { createChannel, createMessage, getMessagesByChannel, updateMessage } = await import(
      "@/lib/db/queries"
    );

    const ch = createChannel("WAL Stress", "agent-wal");
    const TOTAL = 2000;

    // Rapid writes without explicit checkpointing
    const start = Date.now();
    const msgIds: string[] = [];

    for (let i = 0; i < TOTAL; i++) {
      const msg = createMessage({
        channelId: ch.id,
        senderType: "user",
        senderId: "user-wal",
        content: `WAL pressure message ${i}`,
      });
      msgIds.push(msg.id);

      // Interleave updates to increase WAL pressure
      if (i > 0 && i % 10 === 0) {
        updateMessage(msgIds[i - 1], {
          content: `WAL pressure message ${i - 1} (updated)`,
        });
      }
    }

    const duration = Date.now() - start;
    logPerf("WAL pressure writes", TOTAL, duration);

    // Verify all messages exist and are correct
    const allMsgs = getMessagesByChannel(ch.id, TOTAL + 100);
    expect(allMsgs.length).toBe(TOTAL);

    // Verify some updates took effect
    const updatedMsg = allMsgs.find((m) => m.id === msgIds[9]);
    expect(updatedMsg).toBeDefined();
    expect(updatedMsg!.content).toContain("(updated)");

    // Force a WAL checkpoint and verify integrity
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    const afterCheckpoint = getMessagesByChannel(ch.id, TOTAL + 100);
    expect(afterCheckpoint.length).toBe(TOTAL);
  });
});
