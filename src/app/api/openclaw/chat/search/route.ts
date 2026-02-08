import { NextRequest, NextResponse } from "next/server";
import { sanitizeForApi } from "@/lib/api-security";
import { searchMessages, getChannels } from "@/lib/db/queries";
import type { MessageSearchResult, SearchResult } from "@/lib/types/search";

const MAX_QUERY_LENGTH = 500;

// ============================================================================
// GET /api/openclaw/chat/search?q=X — Universal full-text search
// ============================================================================

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const limit = Math.min(parseInt(searchParams.get("limit") || "30", 10), 100);

  if (!q || !q.trim()) {
    return NextResponse.json({ results: [] });
  }

  if (q.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `Search query too long (max ${MAX_QUERY_LENGTH} chars)` },
      { status: 400 }
    );
  }

  try {
    // Build channel name lookup (single query, cached per request)
    const channelList = getChannels();
    const channelMap = new Map<string, string>();
    for (const ch of channelList) {
      channelMap.set(ch.id, ch.name);
    }

    // Search messages across all channels
    const rawMessages = searchMessages(q, undefined, limit);

    // Map raw ChatMessage[] into typed MessageSearchResult[]
    const results: SearchResult[] = rawMessages.map((msg): MessageSearchResult => {
      const channelName = channelMap.get(msg.channelId) || "Unknown";
      const senderName =
        msg.senderType === "user"
          ? "You"
          : msg.senderName || msg.senderId;

      // Truncate snippet to ~200 chars
      const snippet =
        msg.content.length > 200
          ? msg.content.slice(0, 200) + "…"
          : msg.content;

      return {
        id: msg.id,
        type: "message",
        title: `#${channelName}`,
        subtitle: senderName,
        snippet,
        timestamp: msg.createdAt,
        href: `/chat/${msg.channelId}?m=${msg.id}`,
        channelId: msg.channelId,
        channelName,
        messageId: msg.id,
        senderType: msg.senderType,
        senderName,
      };
    });

    // Future: merge results from searchTasks(), searchNotes(), etc.
    // Sort by timestamp descending (already sorted by FTS query)

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[Chat Search] Failed:", (err as Error).message);
    return NextResponse.json(
      { error: sanitizeForApi((err as Error).message) },
      { status: 500 }
    );
  }
}
