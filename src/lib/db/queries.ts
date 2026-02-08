import { eq, desc, and, lt, sql, inArray } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { getDb } from "./index";
import {
  channels,
  channelAgents,
  sessions,
  messages,
  messageAttachments,
  messageReactions,
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

  return rows.map((row) => {
    const agentRows = db
      .select()
      .from(channelAgents)
      .where(eq(channelAgents.channelId, row.id))
      .all();

    return {
      id: row.id,
      name: row.name,
      defaultAgentId: row.defaultAgentId,
      agents: agentRows.map((a) => a.agentId),
      createdAt: row.createdAt,
      archivedAt: row.archivedAt ?? null,
    };
  });
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
  const result = db.delete(channels).where(eq(channels.id, id)).run();
  return result.changes > 0;
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

  db.insert(messages)
    .values({
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
    })
    .run();

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
  const result = db
    .update(messages)
    .set(updates)
    .where(eq(messages.id, id))
    .run();
  return result.changes > 0;
}

export function deleteMessage(id: string): boolean {
  const db = getDb();
  const result = db.delete(messages).where(eq(messages.id, id)).run();
  return result.changes > 0;
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
    // Get the createdAt of the cursor message
    const cursor = db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.id, before))
      .get();

    if (!cursor) return [];

    query = db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.channelId, channelId),
          lt(messages.createdAt, cursor.createdAt)
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
  const rows = query.reverse();

  // Batch-load attachments and reactions
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

  db.insert(sessions)
    .values({
      id,
      channelId: params.channelId,
      sessionKey: params.sessionKey ?? null,
      startedAt: now,
    })
    .run();

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

  // Use raw SQL for FTS5 MATCH — Drizzle doesn't support virtual tables
  const dbInstance = db as unknown as { all: (query: unknown) => unknown[] };

  // Access the underlying better-sqlite3 instance
  type DrizzleInternals = { session: { client: { prepare: (sql: string) => { all: (...params: unknown[]) => Record<string, unknown>[] } } } };
  const sqlite = (db as unknown as DrizzleInternals).session.client;

  let rows: Record<string, unknown>[];

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
    rows = stmt.all(query, channelId, limit);
  } else {
    const stmt = sqlite.prepare(`
      SELECT m.*
      FROM messages m
      JOIN messages_fts fts ON m.rowid = fts.rowid
      WHERE messages_fts MATCH ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `);
    rows = stmt.all(query, limit);
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
