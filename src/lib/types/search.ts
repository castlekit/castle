// ============================================================================
// Universal Search — Type System
// ============================================================================
//
// Discriminated union so every result carries its type and the dialog can
// render + navigate each type differently. Adding a new searchable content
// type later requires only:
//
//   1. Add a new interface extending SearchResultBase
//   2. Add it to the SearchResult union
//   3. Add a renderer in the search dialog
//   4. Add a search function in the API
//
// No changes to the dialog, hook, provider, keyboard shortcuts, or routing.

// --- Content type registry ---

export type SearchResultType = "message" | "task" | "note" | "project";
// ^ Extend this union as new content types are added

// --- Base result shape (shared fields) ---

export interface SearchResultBase {
  id: string;
  type: SearchResultType;
  title: string;        // Primary display text
  subtitle?: string;    // Secondary line (sender, project name, etc.)
  snippet: string;      // Content excerpt with match context
  timestamp: number;    // For sorting / display
  href: string;         // Where to navigate on click
}

// --- Content-specific result types ---

export interface MessageSearchResult extends SearchResultBase {
  type: "message";
  channelId: string;
  channelName: string;
  messageId: string;
  senderType: "user" | "agent";
  senderName: string;
  archived?: boolean;
}

// Future examples (not implemented in v1):
// export interface TaskSearchResult extends SearchResultBase {
//   type: "task";
//   projectId: string;
//   status: "todo" | "in_progress" | "done";
// }
//
// export interface NoteSearchResult extends SearchResultBase {
//   type: "note";
//   notebookId: string;
// }

// --- Discriminated union ---

export type SearchResult = MessageSearchResult;
// ^ Becomes: MessageSearchResult | TaskSearchResult | NoteSearchResult | ...
