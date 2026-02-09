// ============================================================================
// Channel
// ============================================================================

export interface Channel {
  id: string;
  name: string;
  defaultAgentId: string;
  agents: string[];         // Agent IDs in this channel
  createdAt: number;        // unix ms
  archivedAt?: number | null; // unix ms — null if active
}

// ============================================================================
// Session
// ============================================================================

export interface ChannelSession {
  id: string;
  channelId: string;
  sessionKey: string | null; // Gateway session key
  startedAt: number;         // unix ms
  endedAt: number | null;    // unix ms
  summary: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
}

// ============================================================================
// Message
// ============================================================================

export type MessageStatus = "complete" | "interrupted" | "aborted";

export interface ChatMessage {
  id: string;
  channelId: string;
  sessionId: string | null;
  senderType: "user" | "agent";
  senderId: string;
  senderName: string | null;
  content: string;
  status: MessageStatus;
  mentionedAgentId: string | null;
  runId: string | null;       // Gateway run ID for streaming correlation
  sessionKey: string | null;  // Gateway session key
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: number;          // unix ms
  attachments: MessageAttachment[];
  reactions: MessageReaction[];
}

// ============================================================================
// Attachment
// ============================================================================

export interface MessageAttachment {
  id: string;
  messageId: string;
  attachmentType: "image" | "audio";
  filePath: string;
  mimeType: string | null;
  fileSize: number | null;
  originalName: string | null;
  createdAt: number;         // unix ms
}

// ============================================================================
// Reaction
// ============================================================================

export interface MessageReaction {
  id: string;
  messageId: string;
  agentId: string | null;
  emoji: string;
  emojiChar: string;
  createdAt: number;         // unix ms
}

// ============================================================================
// Streaming
// ============================================================================

/** A message currently being streamed from the Gateway */
export interface StreamingMessage {
  runId: string;
  agentId: string;
  agentName: string;
  sessionKey: string;
  content: string;           // Accumulated text so far
  startedAt: number;
}

/** A single streaming delta from the Gateway SSE */
export interface ChatDelta {
  runId: string;
  sessionKey: string;
  seq: number;
  state: "delta" | "final" | "error";
  text?: string;
  errorMessage?: string;
  message?: {
    content?: Array<{ type?: string; text?: string }>;
    role?: string;
    inputTokens?: number;
    outputTokens?: number;
  };
}

// ============================================================================
// Message Queue
// ============================================================================

export interface QueuedMessage {
  id: string;               // Temp ID for tracking
  content: string;
  agentId?: string;
  attachments?: File[];
  addedAt: number;
}

// ============================================================================
// Session Status (read from OpenClaw session store on filesystem)
// ============================================================================

export interface SessionStatus {
  sessionKey: string;
  sessionId: string;
  agentId: string;
  model: string;
  modelProvider: string;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  context: {
    used: number;       // totalTokens (current context window usage)
    limit: number;      // effective operating limit (from config, default 200k)
    modelMax: number;   // model's theoretical max (e.g. 1M for Sonnet 4.5)
    percentage: number; // used / limit * 100
  };
  compactions: number;
  thinkingLevel: string | null;
  updatedAt: number;
  /** System prompt breakdown — only present when the session has run at least once */
  systemPrompt?: {
    totalChars: number;
    projectContextChars: number;
    nonProjectContextChars: number;
    skills: { promptChars: number; count: number };
    tools: { listChars: number; schemaChars: number; count: number };
    workspaceFiles: Array<{
      name: string;
      injectedChars: number;
      truncated: boolean;
    }>;
  };
}

// ============================================================================
// Storage Stats
// ============================================================================

export interface StorageStats {
  messages: number;
  channels: number;
  attachments: number;
  totalAttachmentBytes: number;
  dbSizeBytes?: number;      // Size of castle.db file
}

// ============================================================================
// API Payloads
// ============================================================================

export interface ChatSendRequest {
  channelId: string;
  content: string;
  agentId?: string;
  attachmentIds?: string[];
}

export interface ChatSendResponse {
  runId: string;
  messageId: string;
  sessionKey: string;
}

export interface ChatCompleteRequest {
  runId: string;
  channelId: string;
  content: string;
  sessionKey: string;
  agentId: string;
  agentName?: string;
  status: MessageStatus;
  inputTokens?: number;
  outputTokens?: number;
}
