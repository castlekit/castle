import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type Database from "better-sqlite3";
import type { drizzle } from "drizzle-orm/better-sqlite3";
import { installTestDb } from "./test-db";

// ============================================================================
// Tests
// ============================================================================

describe("Database Queries", () => {
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

    it("should delete a channel and its dependents", async () => {
      const { createChannel, deleteChannel, getChannel } = await import("../queries");

      const channel = createChannel("To Delete", "agent-1");
      const deleted = deleteChannel(channel.id);
      expect(deleted).toBe(true);

      const fetched = getChannel(channel.id);
      expect(fetched).toBeNull();
    });

    it("should return false when deleting nonexistent channel", async () => {
      const { deleteChannel } = await import("../queries");
      expect(deleteChannel("nonexistent-id")).toBe(false);
    });

    it("should archive and restore a channel", async () => {
      const { createChannel, archiveChannel, restoreChannel, getChannel, getChannels } = await import("../queries");

      const channel = createChannel("Archive Test", "agent-1");
      archiveChannel(channel.id);

      // Should not appear in active channels
      const active = getChannels(false);
      expect(active.find((c) => c.id === channel.id)).toBeUndefined();

      // Should appear in archived channels
      const archived = getChannels(true);
      expect(archived.find((c) => c.id === channel.id)).toBeDefined();

      // Restore
      restoreChannel(channel.id);
      const restored = getChannel(channel.id);
      expect(restored!.archivedAt).toBeNull();
    });

    it("should track last accessed channel", async () => {
      const { createChannel, touchChannel, getLastAccessedChannelId } = await import("../queries");

      const ch1 = createChannel("Accessed 1", "agent-1");
      const ch2 = createChannel("Accessed 2", "agent-1");

      touchChannel(ch1.id);
      await new Promise((r) => setTimeout(r, 15)); // ensure different timestamps

      touchChannel(ch2.id);
      expect(getLastAccessedChannelId()).toBe(ch2.id);
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

      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const msg = createMessage({
          channelId: channel.id,
          senderType: "user",
          senderId: "local-user",
          content: `Message ${i}`,
        });
        ids.push(msg.id);
        await new Promise((r) => setTimeout(r, 10));
      }

      const latest = getMessagesByChannel(channel.id, 3);
      expect(latest.length).toBe(3);

      const older = getMessagesByChannel(channel.id, 3, latest[0].id);
      expect(older.length).toBe(2);
    });

    it("should support forward pagination with getMessagesAfter", async () => {
      const { createChannel, createMessage, getMessagesAfter } = await import("../queries");

      const channel = createChannel("Forward Pagination", "agent-1");

      const msgs: string[] = [];
      for (let i = 0; i < 5; i++) {
        const msg = createMessage({
          channelId: channel.id,
          senderType: "user",
          senderId: "local-user",
          content: `FP ${i}`,
        });
        msgs.push(msg.id);
        await new Promise((r) => setTimeout(r, 10));
      }

      const after = getMessagesAfter(channel.id, msgs[1], 10);
      expect(after.length).toBe(3); // msgs[2], msgs[3], msgs[4]
      expect(after[0].content).toBe("FP 2");
    });

    it("should get messages around an anchor", async () => {
      const { createChannel, createMessage, getMessagesAround } = await import("../queries");

      const channel = createChannel("Around Test", "agent-1");

      const msgs: string[] = [];
      for (let i = 0; i < 10; i++) {
        const msg = createMessage({
          channelId: channel.id,
          senderType: "user",
          senderId: "local-user",
          content: `Around ${i}`,
        });
        msgs.push(msg.id);
        await new Promise((r) => setTimeout(r, 10));
      }

      const result = getMessagesAround(channel.id, msgs[5], 6);
      expect(result).not.toBeNull();
      expect(result!.messages.length).toBeGreaterThanOrEqual(4);
      expect(result!.messages.some((m) => m.id === msgs[5])).toBe(true);
    });

    it("should return null for nonexistent anchor", async () => {
      const { createChannel, getMessagesAround } = await import("../queries");

      const channel = createChannel("No Anchor", "agent-1");
      const result = getMessagesAround(channel.id, "nonexistent-id");
      expect(result).toBeNull();
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

    it("should delete a message", async () => {
      const { createChannel, createMessage, deleteMessage, getMessagesByChannel } = await import("../queries");

      const channel = createChannel("Delete Msg Test", "agent-1");
      const msg = createMessage({
        channelId: channel.id,
        senderType: "user",
        senderId: "u1",
        content: "to delete",
      });

      expect(deleteMessage(msg.id)).toBe(true);
      expect(deleteMessage("nonexistent")).toBe(false);

      const msgs = getMessagesByChannel(channel.id);
      expect(msgs.find((m) => m.id === msg.id)).toBeUndefined();
    });

    it("should find a message by runId", async () => {
      const { createChannel, createMessage, updateMessage, getMessageByRunId } = await import("../queries");

      const channel = createChannel("RunId Test", "agent-1");
      const msg = createMessage({
        channelId: channel.id,
        senderType: "agent",
        senderId: "agent-1",
        content: "Agent response",
        runId: "run-xyz-123",
      });

      const found = getMessageByRunId("run-xyz-123");
      expect(found).not.toBeNull();
      expect(found!.id).toBe(msg.id);

      // Should not find user messages with same runId
      createMessage({
        channelId: channel.id,
        senderType: "user",
        senderId: "u1",
        content: "User msg",
        runId: "run-user-only",
      });
      expect(getMessageByRunId("run-user-only")).toBeNull();
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

    it("should search within a specific channel", async () => {
      const { createChannel, createMessage, searchMessages } = await import("../queries");

      const ch1 = createChannel("Search Ch1", "agent-1");
      const ch2 = createChannel("Search Ch2", "agent-1");

      createMessage({ channelId: ch1.id, senderType: "user", senderId: "u1", content: "unique_keyword_alpha" });
      createMessage({ channelId: ch2.id, senderType: "user", senderId: "u1", content: "unique_keyword_alpha" });

      const all = searchMessages("unique_keyword_alpha");
      expect(all.length).toBe(2);

      const ch1Only = searchMessages("unique_keyword_alpha", ch1.id);
      expect(ch1Only.length).toBe(1);
      expect(ch1Only[0].channelId).toBe(ch1.id);
    });

    it("should reject overly long queries", async () => {
      const { searchMessages } = await import("../queries");
      expect(searchMessages("a".repeat(501))).toEqual([]);
    });

    it("should reject empty queries", async () => {
      const { searchMessages } = await import("../queries");
      expect(searchMessages("")).toEqual([]);
      expect(searchMessages("   ")).toEqual([]);
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

    it("should track compaction boundary", async () => {
      const { createChannel, createSession, createMessage, setCompactionBoundary, getCompactionBoundary } = await import("../queries");

      const channel = createChannel("Compaction Test", "agent-1");
      createSession({ channelId: channel.id, sessionKey: "sk_compact" });

      const msg = createMessage({
        channelId: channel.id,
        senderType: "user",
        senderId: "u1",
        content: "boundary msg",
      });

      setCompactionBoundary("sk_compact", msg.id);
      expect(getCompactionBoundary("sk_compact")).toBe(msg.id);
    });

    it("should update session fields", async () => {
      const { createChannel, createSession, updateSession, getSessionsByChannel } = await import("../queries");

      const channel = createChannel("Session Update", "agent-1");
      const session = createSession({ channelId: channel.id, sessionKey: "sk_upd" });

      updateSession(session.id, { summary: "Test summary", totalInputTokens: 1000 });

      const sessions = getSessionsByChannel(channel.id);
      expect(sessions[0].summary).toBe("Test summary");
      expect(sessions[0].totalInputTokens).toBe(1000);
    });
  });

  // ---- Settings ----

  describe("Settings", () => {
    it("should get and set settings", async () => {
      const { getSetting, setSetting, getAllSettings } = await import("../queries");

      expect(getSetting("displayName")).toBeNull();

      setSetting("displayName", "Brian");
      expect(getSetting("displayName")).toBe("Brian");

      // Upsert
      setSetting("displayName", "Updated");
      expect(getSetting("displayName")).toBe("Updated");

      const all = getAllSettings();
      expect(all["displayName"]).toBe("Updated");
    });
  });

  // ---- Agent Statuses ----

  describe("Agent Statuses", () => {
    it("should set and get agent statuses", async () => {
      const { setAgentStatus, getAgentStatuses } = await import("../queries");

      setAgentStatus("agent-test-1", "thinking");
      setAgentStatus("agent-test-2", "active");

      const statuses = getAgentStatuses();
      const s1 = statuses.find((s) => s.agentId === "agent-test-1");
      const s2 = statuses.find((s) => s.agentId === "agent-test-2");

      expect(s1?.status).toBe("thinking");
      expect(s2?.status).toBe("active");
    });

    it("should upsert status", async () => {
      const { setAgentStatus, getAgentStatuses } = await import("../queries");

      setAgentStatus("agent-upsert", "thinking");
      setAgentStatus("agent-upsert", "idle");

      const statuses = getAgentStatuses();
      const s = statuses.find((s) => s.agentId === "agent-upsert");
      expect(s?.status).toBe("idle");
    });
  });

  // ---- Recent Searches ----

  describe("Recent Searches", () => {
    it("should add and retrieve recent searches", async () => {
      const { addRecentSearch, getRecentSearches, clearRecentSearches } = await import("../queries");

      clearRecentSearches();

      addRecentSearch("test query 1");
      await new Promise((r) => setTimeout(r, 15)); // ensure different timestamps
      addRecentSearch("test query 2");

      const recent = getRecentSearches();
      expect(recent.length).toBe(2);
      expect(recent[0]).toBe("test query 2"); // most recent first
      expect(recent[1]).toBe("test query 1");
    });

    it("should deduplicate searches", async () => {
      const { addRecentSearch, getRecentSearches, clearRecentSearches } = await import("../queries");

      clearRecentSearches();

      addRecentSearch("dup query");
      await new Promise((r) => setTimeout(r, 15));
      addRecentSearch("other query");
      await new Promise((r) => setTimeout(r, 15));
      addRecentSearch("dup query"); // should move to top, not duplicate

      const recent = getRecentSearches();
      const dupCount = recent.filter((q) => q === "dup query").length;
      expect(dupCount).toBe(1);
      expect(recent[0]).toBe("dup query"); // moved to top
    });

    it("should skip empty queries", async () => {
      const { addRecentSearch, getRecentSearches, clearRecentSearches } = await import("../queries");

      clearRecentSearches();
      addRecentSearch("");
      addRecentSearch("   ");

      expect(getRecentSearches().length).toBe(0);
    });

    it("should clear all recent searches", async () => {
      const { addRecentSearch, getRecentSearches, clearRecentSearches } = await import("../queries");

      addRecentSearch("to clear");
      clearRecentSearches();

      expect(getRecentSearches().length).toBe(0);
    });
  });

  // ---- Attachments ----

  describe("Attachments", () => {
    it("should create and retrieve attachments", async () => {
      const { createChannel, createMessage, createAttachment, getAttachmentsByMessage } = await import("../queries");

      const channel = createChannel("Attach Test", "agent-1");
      const msg = createMessage({
        channelId: channel.id,
        senderType: "user",
        senderId: "u1",
        content: "with attachment",
      });

      const att = createAttachment({
        messageId: msg.id,
        attachmentType: "image",
        filePath: "/tmp/test.png",
        mimeType: "image/png",
        fileSize: 12345,
        originalName: "test.png",
      });

      expect(att.messageId).toBe(msg.id);
      expect(att.attachmentType).toBe("image");

      const attachments = getAttachmentsByMessage(msg.id);
      expect(attachments.length).toBe(1);
      expect(attachments[0].filePath).toBe("/tmp/test.png");
    });
  });

  // ---- Reactions ----

  describe("Reactions", () => {
    it("should create and retrieve reactions", async () => {
      const { createChannel, createMessage, createReaction, getReactionsByMessage } = await import("../queries");

      const channel = createChannel("React Test", "agent-1");
      const msg = createMessage({
        channelId: channel.id,
        senderType: "agent",
        senderId: "agent-1",
        content: "react to this",
      });

      createReaction({
        messageId: msg.id,
        agentId: "agent-1",
        emoji: "thumbsup",
        emojiChar: "👍",
      });

      const reactions = getReactionsByMessage(msg.id);
      expect(reactions.length).toBe(1);
      expect(reactions[0].emoji).toBe("thumbsup");
      expect(reactions[0].emojiChar).toBe("👍");
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

  // ---- FTS Sync ----

  describe("FTS Sync", () => {
    it("deleteChannel should keep FTS in sync", async () => {
      const { createChannel, createMessage, deleteChannel } = await import("../queries");

      const channel = createChannel("FTS Sync Test", "agent-1");
      createMessage({ channelId: channel.id, senderType: "user", senderId: "u1", content: "msg1" });
      createMessage({ channelId: channel.id, senderType: "user", senderId: "u1", content: "msg2" });
      createMessage({ channelId: channel.id, senderType: "user", senderId: "u1", content: "msg3" });

      const beforeMsg = (sqlite.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c;
      const beforeFts = (sqlite.prepare("SELECT COUNT(*) as c FROM messages_fts_content").get() as { c: number }).c;
      expect(beforeFts).toBe(beforeMsg);

      deleteChannel(channel.id);

      const afterMsg = (sqlite.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c;
      const afterFts = (sqlite.prepare("SELECT COUNT(*) as c FROM messages_fts_content").get() as { c: number }).c;
      expect(afterFts).toBe(afterMsg);

      const orphaned = (sqlite.prepare(
        "SELECT COUNT(*) as c FROM messages_fts_content WHERE id NOT IN (SELECT rowid FROM messages)"
      ).get() as { c: number }).c;
      expect(orphaned).toBe(0);
    });

    it("createMessage should auto-repair FTS and succeed if FTS has orphaned entries", async () => {
      const { createChannel, createMessage } = await import("../queries");

      const channel = createChannel("FTS Repair Test", "agent-1");

      const maxRowid = (sqlite.prepare("SELECT MAX(rowid) as m FROM messages").get() as { m: number | null }).m ?? 0;

      for (let i = 1; i <= 5; i++) {
        sqlite.prepare("INSERT INTO messages_fts(rowid, content) VALUES (?, ?)").run(maxRowid + i, `orphan-${i}`);
      }

      const orphanedBefore = (sqlite.prepare(
        "SELECT COUNT(*) as c FROM messages_fts_content WHERE id NOT IN (SELECT rowid FROM messages)"
      ).get() as { c: number }).c;
      expect(orphanedBefore).toBe(5);

      const msg = createMessage({ channelId: channel.id, senderType: "user", senderId: "u1", content: "after repair" });
      expect(msg.id).toBeTruthy();
      expect(msg.content).toBe("after repair");

      const inDb = sqlite.prepare("SELECT id FROM messages WHERE id = ?").get(msg.id);
      expect(inDb).toBeTruthy();

      const orphanedAfter = (sqlite.prepare(
        "SELECT COUNT(*) as c FROM messages_fts_content WHERE id NOT IN (SELECT rowid FROM messages)"
      ).get() as { c: number }).c;
      expect(orphanedAfter).toBe(0);

      const msgCount = (sqlite.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c;
      const ftsCount = (sqlite.prepare("SELECT COUNT(*) as c FROM messages_fts_content").get() as { c: number }).c;
      expect(ftsCount).toBe(msgCount);
    });
  });
});
