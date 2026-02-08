import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

// ============================================================================
// channels
// ============================================================================

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  defaultAgentId: text("default_agent_id").notNull(),
  createdAt: integer("created_at").notNull(), // unix ms
  updatedAt: integer("updated_at"),           // unix ms
  lastAccessedAt: integer("last_accessed_at"), // unix ms — last time user opened this channel
  archivedAt: integer("archived_at"),           // unix ms — null if active, set when archived
});

// ============================================================================
// settings (key-value store for user preferences)
// ============================================================================

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(), // unix ms
});

// ============================================================================
// channel_agents (many-to-many junction)
// ============================================================================

export const channelAgents = sqliteTable(
  "channel_agents",
  {
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.agentId] }),
  ]
);

// ============================================================================
// sessions
// ============================================================================

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    sessionKey: text("session_key"),           // Gateway session key
    startedAt: integer("started_at").notNull(), // unix ms
    endedAt: integer("ended_at"),               // unix ms, nullable
    summary: text("summary"),
    totalInputTokens: integer("total_input_tokens").default(0),
    totalOutputTokens: integer("total_output_tokens").default(0),
  },
  (table) => [
    index("idx_sessions_channel").on(table.channelId, table.startedAt),
  ]
);

// ============================================================================
// messages
// ============================================================================

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id),
    senderType: text("sender_type").notNull(), // "user" | "agent"
    senderId: text("sender_id").notNull(),
    senderName: text("sender_name"),
    content: text("content").notNull().default(""),
    status: text("status").notNull().default("complete"), // "complete" | "interrupted" | "aborted"
    mentionedAgentId: text("mentioned_agent_id"),
    runId: text("run_id"),                     // Gateway run ID for streaming correlation
    sessionKey: text("session_key"),           // Gateway session key
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: integer("created_at").notNull(), // unix ms
  },
  (table) => [
    index("idx_messages_channel").on(table.channelId, table.createdAt),
    index("idx_messages_session").on(table.sessionId, table.createdAt),
    index("idx_messages_run_id").on(table.runId),
  ]
);

// ============================================================================
// message_attachments
// ============================================================================

export const messageAttachments = sqliteTable(
  "message_attachments",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    attachmentType: text("attachment_type").notNull(), // "image" | "audio"
    filePath: text("file_path").notNull(),
    mimeType: text("mime_type"),
    fileSize: integer("file_size"),
    originalName: text("original_name"),
    createdAt: integer("created_at").notNull(), // unix ms
  },
  (table) => [
    index("idx_attachments_message").on(table.messageId),
  ]
);

// ============================================================================
// message_reactions
// ============================================================================

export const messageReactions = sqliteTable(
  "message_reactions",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    agentId: text("agent_id"),
    emoji: text("emoji").notNull(),
    emojiChar: text("emoji_char").notNull(),
    createdAt: integer("created_at").notNull(), // unix ms
  },
  (table) => [
    index("idx_reactions_message").on(table.messageId),
  ]
);
