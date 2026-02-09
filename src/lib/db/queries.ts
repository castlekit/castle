import { eq, desc, asc, and, lt, gt, sql, inArray } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { getDb } from "./index";
import {
  channels,
  channelAgents,
  sessions,
  messages,
  messageAttachments,
  messageReactions,
  recentSearches,
  settings,
  agentStatuses,
} from "./schema";
import type {
  Channel,
  ChatMessage,
  ChannelSession,
  MessageAttachment,
  MessageReaction,
} from "@/lib/types/chat";

// ============================================================================
// Channels
// ============================================================================

export function createChannel(
  name: string,
  defaultAgentId: string,
  agentIds: string[] = []
): Channel {
  const db = getDb();
  const id = uuid();
  const now = Date.now();

  db.insert(channels).values({
    id,
    name,
    defaultAgentId,
    createdAt: now,
    updatedAt: now,
  }).run();

  // Add agents to junction table
  const agents = agentIds.length > 0 ? agentIds : [defaultAgentId];
  for (const agentId of agents) {
    db.insert(channelAgents)
      .values({ channelId: id, agentId })
      .run();
  }

  return {
    id,
    name,
    defaultAgentId,
    agents,
    createdAt: now,
  };
}

export function getChannels(includeArchived = false): Channel[] {
  const db = getDb();

  const query = includeArchived
    ? db.select().from(channels).where(sql`${channels.archivedAt} IS NOT NULL`).orderBy(desc(channels.archivedAt))
    : db.select().from(channels).where(sql`${channels.archivedAt} IS NULL`).orderBy(desc(channels.createdAt));

  const rows = query.all();
  if (rows.length === 0) return [];

  // Batch-load all channel agents in one query (avoids N+1)
  const channelIds = rows.map((r) => r.id);
  const allAgentRows = db
    .select()
    .from(channelAgents)
    .where(inArray(channelAgents.channelId, channelIds))
    .all();

  const agentsByChannel = new Map<string, string[]>();
  for (const a of allAgentRows) {
    const list = agentsByChannel.get(a.channelId) || [];
    list.push(a.agentId);
    agentsByChannel.set(a.channelId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    defaultAgentId: row.defaultAgentId,
    agents: agentsByChannel.get(row.id) || [],
    createdAt: row.createdAt,
    archivedAt: row.archivedAt ?? null,
  }));
}

export function getChannel(id: string): Channel | null {
  const db = getDb();
  const row = db.select().from(channels).where(eq(channels.id, id)).get();
  if (!row) return null;

  const agentRows = db
    .select()
    .from(channelAgents)
    .where(eq(channelAgents.channelId, id))
    .all();

  return {
    id: row.id,
    name: row.name,
    defaultAgentId: row.defaultAgentId,
    agents: agentRows.map((a) => a.agentId),
    createdAt: row.createdAt,
    archivedAt: row.archivedAt ?? null,
  };
}

export function updateChannel(
  id: string,
  updates: { name?: string; defaultAgentId?: string }
): boolean {
  const db = getDb();
  const result = db
    .update(channels)
    .set({ ...updates, updatedAt: Date.now() })
    .where(eq(channels.id, id))
    .run();
  return result.changes > 0;
}

export function deleteChannel(id: string): boolean {
  const db = getDb();

  // Access underlying better-sqlite3 for raw SQL operations
  type SqliteClient = {
    prepare: (sql: string) => { run: (...params: unknown[]) => { changes: number }; all: (...params: unknown[]) => Record<string, unknown>[] };
    exec: (sql: string) => void;
  };
  type DrizzleDb = { session: { client: SqliteClient } };
  const sqlite = (db as unknown as DrizzleDb).session.client;

  // Delete dependent records: attachments/reactions → messages → sessions → agents → channel.
  // The FTS5 delete trigger fires for each message deletion to keep FTS in sync.
  // If the trigger fails (FTS out of sync), we catch and rebuild FTS afterwards.
  let needsFtsRebuild = false;

  try {
    const msgIds = db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.channelId, id))
      .all()
      .map((r) => r.id);

    if (msgIds.length > 0) {
      db.delete(messageAttachments)
        .where(inArray(messageAttachments.messageId, msgIds))
        .run();
      db.delete(messageReactions)
        .where(inArray(messageReactions.messageId, msgIds))
        .run();
    }

    try {
      db.delete(messages).where(eq(messages.channelId, id)).run();
    } catch (err) {
      // FTS trigger failed — likely FTS out of sync. Delete messages without trigger,
      // then rebuild FTS from scratch.
      console.warn("[deleteChannel] FTS trigger failed during message deletion, will rebuild:", (err as Error).message);
      sqlite.exec("DROP TRIGGER IF EXISTS messages_fts_delete");
      db.delete(messages).where(eq(messages.channelId, id)).run();
      needsFtsRebuild = true;
    }

    db.delete(sessions).where(eq(sessions.channelId, id)).run();
    db.delete(channelAgents).where(eq(channelAgents.channelId, id)).run();

    const result = db.delete(channels).where(eq(channels.id, id)).run();
    return result.changes > 0;
  } finally {
    if (needsFtsRebuild) {
      // Recreate the trigger and fully resync FTS from the messages table
      sqlite.exec(`
        CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
        END;
      `);
      sqlite.exec("DELETE FROM messages_fts");
      sqlite.exec(
        "INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages"
      );
      console.log("[deleteChannel] FTS5 index rebuilt successfully.");
    }
  }
}

export function archiveChannel(id: string): boolean {
  const db = getDb();
  const result = db
    .update(channels)
    .set({ archivedAt: Date.now() })
    .where(eq(channels.id, id))
    .run();
  return result.changes > 0;
}

export function restoreChannel(id: string): boolean {
  const db = getDb();
  const result = db
    .update(channels)
    .set({ archivedAt: null })
    .where(eq(channels.id, id))
    .run();
  return result.changes > 0;
}

/**
 * Mark a channel as accessed (updates last_accessed_at to now).
 */
export function touchChannel(id: string): void {
  const db = getDb();
  db.update(channels)
    .set({ lastAccessedAt: Date.now() })
    .where(eq(channels.id, id))
    .run();
}

/**
 * Get the most recently accessed channel ID, or null if none.
 */
export function getLastAccessedChannelId(): string | null {
  const db = getDb();
  const row = db
    .select({ id: channels.id })
    .from(channels)
    .where(and(
      sql`${channels.lastAccessedAt} IS NOT NULL`,
      sql`${channels.archivedAt} IS NULL`
    ))
    .orderBy(desc(channels.lastAccessedAt))
    .limit(1)
    .get();
  return row?.id ?? null;
}

// ============================================================================
// Messages
// ============================================================================

export function createMessage(params: {
  channelId: string;
  sessionId?: string;
  senderType: "user" | "agent";
  senderId: string;
  senderName?: string;
  content: string;
  status?: "complete" | "interrupted" | "aborted";
  mentionedAgentId?: string;
  runId?: string;
  sessionKey?: string;
  inputTokens?: number;
  outputTokens?: number;
}): ChatMessage {
  const db = getDb();
  const id = uuid();
  const now = Date.now();

  const insertValues = {
    id,
    channelId: params.channelId,
    sessionId: params.sessionId ?? null,
    senderType: params.senderType,
    senderId: params.senderId,
    senderName: params.senderName ?? null,
    content: params.content,
    status: params.status ?? "complete",
    mentionedAgentId: params.mentionedAgentId ?? null,
    runId: params.runId ?? null,
    sessionKey: params.sessionKey ?? null,
    inputTokens: params.inputTokens ?? null,
    outputTokens: params.outputTokens ?? null,
    createdAt: now,
  };

  try {
    db.insert(messages).values(insertValues).run();
  } catch (err) {
    const code = (err as { code?: string }).code;

    // FTS5 trigger can fail with SQLITE_CONSTRAINT_PRIMARYKEY if the FTS index
    // has orphaned entries from a previous bug. Auto-repair: rebuild FTS and retry.
    if (code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      console.warn(
        `[createMessage] FTS constraint error — rebuilding FTS index and retrying (id=${id}, channelId=${params.channelId})`
      );
      type SqliteClient = { exec: (sql: string) => void };
      type DrizzleDb = { session: { client: SqliteClient } };
      const sqlite = (db as unknown as DrizzleDb).session.client;
      sqlite.exec("DELETE FROM messages_fts");
      sqlite.exec(
        "INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages"
      );
      // Retry the insert — FTS is now clean
      db.insert(messages).values(insertValues).run();
      console.log("[createMessage] Retry succeeded after FTS rebuild.");
    } else {
      throw err;
    }
  }

  return {
    id,
    channelId: params.channelId,
    sessionId: params.sessionId ?? null,
    senderType: params.senderType,
    senderId: params.senderId,
    senderName: params.senderName ?? null,
    content: params.content,
    status: params.status ?? "complete",
    mentionedAgentId: params.mentionedAgentId ?? null,
    runId: params.runId ?? null,
    sessionKey: params.sessionKey ?? null,
    inputTokens: params.inputTokens ?? null,
    outputTokens: params.outputTokens ?? null,
    createdAt: now,
    attachments: [],
    reactions: [],
  };
}

export function updateMessage(
  id: string,
  updates: {
    content?: string;
    status?: "complete" | "interrupted" | "aborted";
    runId?: string;
    sessionKey?: string;
    inputTokens?: number;
    outputTokens?: number;
  }
): boolean {
  const db = getDb();
  try {
    const result = db
      .update(messages)
      .set(updates)
      .where(eq(messages.id, id))
      .run();
    return result.changes > 0;
  } catch (err) {
    const code = (err as { code?: string }).code;
    // FTS5 update trigger can fail if the index is out of sync.
    // Auto-repair: drop trigger, update, rebuild FTS, recreate trigger.
    if (code === "SQLITE_ERROR" && updates.content !== undefined) {
      console.warn(`[DB] updateMessage FTS error — dropping trigger, retrying, rebuilding (id=${id})`);
      type SqliteClient = { exec: (sql: string) => void };
      type DrizzleDb = { session: { client: SqliteClient } };
      const sqlite = (db as unknown as DrizzleDb).session.client;
      sqlite.exec("DROP TRIGGER IF EXISTS messages_fts_update");
      const result = db.update(messages).set(updates).where(eq(messages.id, id)).run();
      sqlite.exec(`
        CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
          INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
        END;
      `);
      sqlite.exec("DELETE FROM messages_fts");
      sqlite.exec("INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages");
      console.log("[DB] updateMessage retry succeeded after FTS rebuild.");
      return result.changes > 0;
    }
    console.error(`[DB] updateMessage FAILED — id=${id} keys=${Object.keys(updates).join(",")}:`, (err as Error).message);
    throw err;
  }
}

export function deleteMessage(id: string): boolean {
  const db = getDb();
  try {
    const result = db.delete(messages).where(eq(messages.id, id)).run();
    return result.changes > 0;
  } catch (err) {
    const code = (err as { code?: string }).code;
    // FTS5 delete trigger can fail if the index is out of sync.
    // Auto-repair: drop trigger, delete, rebuild FTS, recreate trigger.
    if (code === "SQLITE_ERROR") {
      console.warn(`[DB] deleteMessage FTS error — dropping trigger, retrying, rebuilding (id=${id})`);
      type SqliteClient = { exec: (sql: string) => void };
      type DrizzleDb = { session: { client: SqliteClient } };
      const sqlite = (db as unknown as DrizzleDb).session.client;
      sqlite.exec("DROP TRIGGER IF EXISTS messages_fts_delete");
      const result = db.delete(messages).where(eq(messages.id, id)).run();
      sqlite.exec(`
        CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
        END;
      `);
      sqlite.exec("DELETE FROM messages_fts");
      sqlite.exec("INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages");
      console.log("[DB] deleteMessage retry succeeded after FTS rebuild.");
      return result.changes > 0;
    }
    console.error(`[DB] deleteMessage FAILED — id=${id}:`, (err as Error).message);
    throw err;
  }
}

/**
 * Hydrate raw message rows with attachments and reactions.
 * Shared by getMessagesByChannel, getMessagesAfter, and getMessagesAround.
 */
function hydrateMessages(rows: typeof messages.$inferSelect[]): ChatMessage[] {
  const db = getDb();
  const messageIds = rows.map((r) => r.id);

  const attachmentRows = messageIds.length > 0
    ? db.select().from(messageAttachments).where(inArray(messageAttachments.messageId, messageIds)).all()
    : [];
  const reactionRows = messageIds.length > 0
    ? db.select().from(messageReactions).where(inArray(messageReactions.messageId, messageIds)).all()
    : [];

  const attachmentsByMsg = new Map<string, MessageAttachment[]>();
  for (const a of attachmentRows) {
    const list = attachmentsByMsg.get(a.messageId) || [];
    list.push({
      id: a.id,
      messageId: a.messageId,
      attachmentType: a.attachmentType as "image" | "audio",
      filePath: a.filePath,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
      originalName: a.originalName,
      createdAt: a.createdAt,
    });
    attachmentsByMsg.set(a.messageId, list);
  }

  const reactionsByMsg = new Map<string, MessageReaction[]>();
  for (const r of reactionRows) {
    const list = reactionsByMsg.get(r.messageId) || [];
    list.push({
      id: r.id,
      messageId: r.messageId,
      agentId: r.agentId,
      emoji: r.emoji,
      emojiChar: r.emojiChar,
      createdAt: r.createdAt,
    });
    reactionsByMsg.set(r.messageId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    channelId: row.channelId,
    sessionId: row.sessionId,
    senderType: row.senderType as "user" | "agent",
    senderId: row.senderId,
    senderName: row.senderName,
    content: row.content,
    status: row.status as "complete" | "interrupted" | "aborted",
    mentionedAgentId: row.mentionedAgentId,
    runId: row.runId,
    sessionKey: row.sessionKey,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    createdAt: row.createdAt,
    attachments: attachmentsByMsg.get(row.id) || [],
    reactions: reactionsByMsg.get(row.id) || [],
  }));
}

/**
 * Get messages for a channel with cursor-based pagination.
 * @param channelId - Channel to load messages for
 * @param limit - Max messages to return (default 50)
 * @param before - Message ID cursor — returns messages older than this
 */
export function getMessagesByChannel(
  channelId: string,
  limit = 50,
  before?: string
): ChatMessage[] {
  const db = getDb();

  let query;
  if (before) {
    const cursor = db
      .select({ createdAt: messages.createdAt, id: messages.id })
      .from(messages)
      .where(eq(messages.id, before))
      .get();

    if (!cursor) return [];

    // Composite cursor (createdAt, id) to avoid skipping messages with identical timestamps
    query = db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.channelId, channelId),
          sql`(${messages.createdAt}, ${messages.id}) < (${cursor.createdAt}, ${cursor.id})`
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .all();
  } else {
    query = db
      .select()
      .from(messages)
      .where(eq(messages.channelId, channelId))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .all();
  }

  // Reverse to chronological order
  return hydrateMessages(query.reverse());
}

/**
 * Get messages for a channel AFTER a cursor (forward pagination).
 * Returns messages newer than the cursor, in chronological order.
 */
export function getMessagesAfter(
  channelId: string,
  afterId: string,
  limit = 50
): ChatMessage[] {
  const db = getDb();

  const cursor = db
    .select({ createdAt: messages.createdAt, id: messages.id })
    .from(messages)
    .where(eq(messages.id, afterId))
    .get();

  if (!cursor) return [];

  // Composite cursor (createdAt, id) to avoid skipping messages with identical timestamps
  const rows = db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.channelId, channelId),
        sql`(${messages.createdAt}, ${messages.id}) > (${cursor.createdAt}, ${cursor.id})`
      )
    )
    .orderBy(asc(messages.createdAt))
    .limit(limit)
    .all();

  return hydrateMessages(rows);
}

/**
 * Get a window of messages around an anchor message.
 * Returns ~limit messages centered on the anchor, plus hasMoreBefore/hasMoreAfter flags.
 */
export function getMessagesAround(
  channelId: string,
  anchorMessageId: string,
  limit = 50
): { messages: ChatMessage[]; hasMoreBefore: boolean; hasMoreAfter: boolean } | null {
  const db = getDb();

  // Look up the anchor message
  const anchor = db
    .select()
    .from(messages)
    .where(and(eq(messages.id, anchorMessageId), eq(messages.channelId, channelId)))
    .get();

  if (!anchor) return null;

  const half = Math.floor(limit / 2);

  // Messages before the anchor (composite cursor, DESC then reverse)
  const beforeRows = db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.channelId, channelId),
        sql`(${messages.createdAt}, ${messages.id}) < (${anchor.createdAt}, ${anchor.id})`
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(half)
    .all()
    .reverse();

  // Messages after the anchor (composite cursor, ASC)
  const afterRows = db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.channelId, channelId),
        sql`(${messages.createdAt}, ${messages.id}) > (${anchor.createdAt}, ${anchor.id})`
      )
    )
    .orderBy(asc(messages.createdAt))
    .limit(half)
    .all();

  // Combine: before + anchor + after (chronological order)
  const allRows = [...beforeRows, anchor, ...afterRows];

  return {
    messages: hydrateMessages(allRows),
    hasMoreBefore: beforeRows.length === half,
    hasMoreAfter: afterRows.length === half,
  };
}

/**
 * Find an agent message by runId (for updating partial saves).
 * Only matches agent messages — user messages also carry the runId as a reference
 * to the run they triggered, but should never be overwritten with agent content.
 */
export function getMessageByRunId(runId: string) {
  const db = getDb();
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.runId, runId), eq(messages.senderType, "agent")))
    .get() ?? null;
}

// ============================================================================
// Sessions
// ============================================================================

export function createSession(params: {
  channelId: string;
  sessionKey?: string;
}): ChannelSession {
  const db = getDb();
  const id = uuid();
  const now = Date.now();

  try {
    db.insert(sessions)
      .values({
        id,
        channelId: params.channelId,
        sessionKey: params.sessionKey ?? null,
        startedAt: now,
      })
      .run();
  } catch (err) {
    console.error(`[DB] createSession FAILED — channelId=${params.channelId} sessionKey=${params.sessionKey}:`, (err as Error).message);
    throw err;
  }

  return {
    id,
    channelId: params.channelId,
    sessionKey: params.sessionKey ?? null,
    startedAt: now,
    endedAt: null,
    summary: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
}

export function updateSession(
  id: string,
  updates: {
    sessionKey?: string;
    endedAt?: number;
    summary?: string;
    totalInputTokens?: number;
    totalOutputTokens?: number;
  }
): boolean {
  const db = getDb();
  const result = db
    .update(sessions)
    .set(updates)
    .where(eq(sessions.id, id))
    .run();
  return result.changes > 0;
}

export function getSessionsByChannel(channelId: string): ChannelSession[] {
  const db = getDb();
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.channelId, channelId))
    .orderBy(desc(sessions.startedAt))
    .all()
    .map((row) => ({
      id: row.id,
      channelId: row.channelId,
      sessionKey: row.sessionKey,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      summary: row.summary,
      totalInputTokens: row.totalInputTokens ?? 0,
      totalOutputTokens: row.totalOutputTokens ?? 0,
    }));
}

export function getLatestSessionKey(channelId: string): string | null {
  const db = getDb();
  const row = db
    .select({ sessionKey: sessions.sessionKey })
    .from(sessions)
    .where(eq(sessions.channelId, channelId))
    .orderBy(desc(sessions.startedAt))
    .limit(1)
    .get();
  return row?.sessionKey ?? null;
}

/**
 * Update the compaction boundary for a session (by session key).
 * The boundary message ID is the oldest message still in the agent's context.
 */
export function setCompactionBoundary(
  sessionKey: string,
  boundaryMessageId: string
): boolean {
  const db = getDb();
  const result = db
    .update(sessions)
    .set({ compactionBoundaryMessageId: boundaryMessageId })
    .where(eq(sessions.sessionKey, sessionKey))
    .run();
  return result.changes > 0;
}

/**
 * Get the compaction boundary message ID for a session (by session key).
 */
export function getCompactionBoundary(sessionKey: string): string | null {
  const db = getDb();
  const row = db
    .select({ boundaryId: sessions.compactionBoundaryMessageId })
    .from(sessions)
    .where(eq(sessions.sessionKey, sessionKey))
    .limit(1)
    .get();
  return row?.boundaryId ?? null;
}

// ============================================================================
// Attachments
// ============================================================================

export function createAttachment(params: {
  messageId: string;
  attachmentType: "image" | "audio";
  filePath: string;
  mimeType?: string;
  fileSize?: number;
  originalName?: string;
}): MessageAttachment {
  const db = getDb();
  const id = uuid();
  const now = Date.now();

  db.insert(messageAttachments)
    .values({
      id,
      messageId: params.messageId,
      attachmentType: params.attachmentType,
      filePath: params.filePath,
      mimeType: params.mimeType ?? null,
      fileSize: params.fileSize ?? null,
      originalName: params.originalName ?? null,
      createdAt: now,
    })
    .run();

  return {
    id,
    messageId: params.messageId,
    attachmentType: params.attachmentType,
    filePath: params.filePath,
    mimeType: params.mimeType ?? null,
    fileSize: params.fileSize ?? null,
    originalName: params.originalName ?? null,
    createdAt: now,
  };
}

export function getAttachmentsByMessage(messageId: string): MessageAttachment[] {
  const db = getDb();
  return db
    .select()
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, messageId))
    .all()
    .map((row) => ({
      id: row.id,
      messageId: row.messageId,
      attachmentType: row.attachmentType as "image" | "audio",
      filePath: row.filePath,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
      originalName: row.originalName,
      createdAt: row.createdAt,
    }));
}

// ============================================================================
// Reactions
// ============================================================================

export function createReaction(params: {
  messageId: string;
  agentId?: string;
  emoji: string;
  emojiChar: string;
}): MessageReaction {
  const db = getDb();
  const id = uuid();
  const now = Date.now();

  db.insert(messageReactions)
    .values({
      id,
      messageId: params.messageId,
      agentId: params.agentId ?? null,
      emoji: params.emoji,
      emojiChar: params.emojiChar,
      createdAt: now,
    })
    .run();

  return {
    id,
    messageId: params.messageId,
    agentId: params.agentId ?? null,
    emoji: params.emoji,
    emojiChar: params.emojiChar,
    createdAt: now,
  };
}

export function getReactionsByMessage(messageId: string): MessageReaction[] {
  const db = getDb();
  return db
    .select()
    .from(messageReactions)
    .where(eq(messageReactions.messageId, messageId))
    .all()
    .map((row) => ({
      id: row.id,
      messageId: row.messageId,
      agentId: row.agentId,
      emoji: row.emoji,
      emojiChar: row.emojiChar,
      createdAt: row.createdAt,
    }));
}

// ============================================================================
// Search (FTS5)
// ============================================================================

/**
 * Full-text search across messages using FTS5.
 * Uses parameterized MATCH queries for safety.
 */
export function searchMessages(
  query: string,
  channelId?: string,
  limit = 30
): ChatMessage[] {
  const db = getDb();

  // Safety: reject overly long queries
  if (!query || query.length > 500) return [];

  // Sanitize FTS5 query: wrap each word in double quotes to prevent FTS5 operator injection.
  // FTS5 supports operators like AND, OR, NOT, NEAR, and column filters — quoting each
  // term treats them as literal strings instead of operators.
  const sanitizedQuery = query
    .replace(/"/g, "") // Remove existing quotes to prevent breaking out
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term}"`)
    .join(" ");

  if (!sanitizedQuery) return [];

  // Use raw SQL for FTS5 MATCH — Drizzle doesn't support virtual tables
  const dbInstance = db as unknown as { all: (query: unknown) => unknown[] };

  // Access the underlying better-sqlite3 instance
  type DrizzleInternals = { session: { client: { prepare: (sql: string) => { all: (...params: unknown[]) => Record<string, unknown>[] } } } };
  const sqlite = (db as unknown as DrizzleInternals).session.client;

  let rows: Record<string, unknown>[];

  try {
    if (channelId) {
      const stmt = sqlite.prepare(`
        SELECT m.*
        FROM messages m
        JOIN messages_fts fts ON m.rowid = fts.rowid
        WHERE messages_fts MATCH ?
          AND m.channel_id = ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `);
      rows = stmt.all(sanitizedQuery, channelId, limit);
    } else {
      const stmt = sqlite.prepare(`
        SELECT m.*
        FROM messages m
        JOIN messages_fts fts ON m.rowid = fts.rowid
        WHERE messages_fts MATCH ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `);
      rows = stmt.all(sanitizedQuery, limit);
    }
  } catch (err) {
    console.error(`[DB] searchMessages FTS FAILED — query="${sanitizedQuery}" channelId=${channelId}:`, (err as Error).message);
    return [];
  }

  return rows.map((row) => ({
    id: row.id as string,
    channelId: row.channel_id as string,
    sessionId: (row.session_id as string) ?? null,
    senderType: row.sender_type as "user" | "agent",
    senderId: row.sender_id as string,
    senderName: (row.sender_name as string) ?? null,
    content: row.content as string,
    status: (row.status as "complete" | "interrupted" | "aborted") ?? "complete",
    mentionedAgentId: (row.mentioned_agent_id as string) ?? null,
    runId: (row.run_id as string) ?? null,
    sessionKey: (row.session_key as string) ?? null,
    inputTokens: (row.input_tokens as number) ?? null,
    outputTokens: (row.output_tokens as number) ?? null,
    createdAt: row.created_at as number,
    attachments: [],
    reactions: [],
  }));
}

// ============================================================================
// Storage Stats
// ============================================================================

export function getStorageStats() {
  const db = getDb();

  const messageCount = db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .get();

  const channelCount = db
    .select({ count: sql<number>`count(*)` })
    .from(channels)
    .get();

  const attachmentCount = db
    .select({ count: sql<number>`count(*)` })
    .from(messageAttachments)
    .get();

  // Total attachment size from DB metadata
  const totalAttachmentSize = db
    .select({ total: sql<number>`COALESCE(SUM(file_size), 0)` })
    .from(messageAttachments)
    .get();

  return {
    messages: messageCount?.count ?? 0,
    channels: channelCount?.count ?? 0,
    attachments: attachmentCount?.count ?? 0,
    totalAttachmentBytes: totalAttachmentSize?.total ?? 0,
  };
}

// ============================================================================
// Settings
// ============================================================================

/**
 * Get a setting value by key. Returns null if not set.
 */
export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row?.value ?? null;
}

/**
 * Get all settings as a key-value record.
 */
export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.select().from(settings).all();
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

/**
 * Set a setting value (upsert).
 */
export function setSetting(key: string, value: string): void {
  const db = getDb();
  const existing = db
    .select({ key: settings.key })
    .from(settings)
    .where(eq(settings.key, key))
    .get();

  if (existing) {
    db.update(settings)
      .set({ value, updatedAt: Date.now() })
      .where(eq(settings.key, key))
      .run();
  } else {
    db.insert(settings)
      .values({ key, value, updatedAt: Date.now() })
      .run();
  }
}

// ============================================================================
// Agent Statuses
// ============================================================================

const ACTIVE_DURATION_MS = 2 * 60 * 1000; // 2 minutes

export type AgentStatusValue = "idle" | "thinking" | "active";

export interface AgentStatusRow {
  agentId: string;
  status: AgentStatusValue;
  updatedAt: number;
}

/**
 * Get all agent statuses. If an agent's status is "active" but updated_at
 * is more than 2 minutes ago, it's returned as "idle" instead.
 */
export function getAgentStatuses(): AgentStatusRow[] {
  const db = getDb();
  const rows = db.select().from(agentStatuses).all();
  const now = Date.now();

  return rows.map((row) => {
    const status = row.status as AgentStatusValue;
    // Auto-expire "active" status after 2 minutes
    if (status === "active" && now - row.updatedAt > ACTIVE_DURATION_MS) {
      return { agentId: row.agentId, status: "idle" as AgentStatusValue, updatedAt: row.updatedAt };
    }
    return { agentId: row.agentId, status, updatedAt: row.updatedAt };
  });
}

/**
 * Set an agent's status. Upserts the row.
 */
export function setAgentStatus(agentId: string, status: AgentStatusValue): void {
  const db = getDb();
  const now = Date.now();

  const existing = db.select().from(agentStatuses).where(eq(agentStatuses.agentId, agentId)).get();
  if (existing) {
    db.update(agentStatuses)
      .set({ status, updatedAt: now })
      .where(eq(agentStatuses.agentId, agentId))
      .run();
  } else {
    db.insert(agentStatuses)
      .values({ agentId, status, updatedAt: now })
      .run();
  }
}

// ============================================================================
// Recent Searches
// ============================================================================

const MAX_RECENT_SEARCHES = 15;

export function getRecentSearches(): string[] {
  const db = getDb();
  const rows = db
    .select({ query: recentSearches.query })
    .from(recentSearches)
    .orderBy(desc(recentSearches.createdAt))
    .limit(MAX_RECENT_SEARCHES)
    .all();
  return rows.map((r) => r.query);
}

export function addRecentSearch(query: string): void {
  const db = getDb();
  const trimmed = query.trim();
  if (!trimmed) return;

  // Remove duplicate if it already exists
  db.delete(recentSearches)
    .where(eq(recentSearches.query, trimmed))
    .run();

  // Insert as most recent
  db.insert(recentSearches)
    .values({ query: trimmed, createdAt: Date.now() })
    .run();

  // Prune old entries beyond the limit
  const all = db
    .select({ id: recentSearches.id })
    .from(recentSearches)
    .orderBy(desc(recentSearches.createdAt))
    .all();

  if (all.length > MAX_RECENT_SEARCHES) {
    const toDelete = all.slice(MAX_RECENT_SEARCHES).map((r) => r.id);
    db.delete(recentSearches)
      .where(inArray(recentSearches.id, toDelete))
      .run();
  }
}

export function clearRecentSearches(): void {
  const db = getDb();
  db.delete(recentSearches).run();
}
