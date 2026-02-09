import { NextRequest, NextResponse } from "next/server";
import { sanitizeForApi, checkRateLimit, rateLimitKey, checkCsrf } from "@/lib/api-security";
import { searchMessages, getChannels, getRecentSearches, addRecentSearch, clearRecentSearches } from "@/lib/db/queries";
import type { MessageSearchResult, SearchResult } from "@/lib/types/search";

const MAX_QUERY_LENGTH = 500;

// ============================================================================
// GET /api/openclaw/chat/search?q=X — Universal full-text search
// ============================================================================

export async function GET(request: NextRequest) {
  // Rate limit: 60 searches per minute
  const rl = checkRateLimit(rateLimitKey(request, "chat:search"), 60);
  if (rl) return rl;

  const { searchParams } = new URL(request.url);

  // GET /api/openclaw/chat/search?recent=1 — return recent searches
  if (searchParams.get("recent") === "1") {
    try {
      const recent = getRecentSearches();
      return NextResponse.json({ recent });
    } catch (err) {
      console.error("[Chat Search] Recent failed:", (err as Error).message);
      return NextResponse.json({ recent: [] });
    }
  }

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
    // Build channel name lookup — include archived channels so their
    // names still resolve in search results.
    const activeChannels = getChannels(false);
    const archivedChannels = getChannels(true);
    const channelMap = new Map<string, { name: string; archived: boolean }>();
    for (const ch of activeChannels) {
      channelMap.set(ch.id, { name: ch.name, archived: false });
    }
    for (const ch of archivedChannels) {
      channelMap.set(ch.id, { name: ch.name, archived: true });
    }

    // Search messages across all channels
    const rawMessages = searchMessages(q, undefined, limit);

    // Map raw ChatMessage[] into typed MessageSearchResult[]
    const results: SearchResult[] = rawMessages.map((msg): MessageSearchResult => {
      const ch = channelMap.get(msg.channelId);
      const channelName = ch?.name || "Unknown";
      const archived = ch?.archived ?? false;
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
        archived,
      };
    });

    // Future: merge results from searchTasks(), searchNotes(), etc.
    // Sort by timestamp descending (already sorted by FTS query)

    console.log(`[Search API] GET OK — query="${q.slice(0, 50)}" results=${results.length}`);
    return NextResponse.json({ results });
  } catch (err) {
    console.error(`[Search API] GET FAILED — query="${q?.slice(0, 50)}":`, (err as Error).message);
    return NextResponse.json(
      { error: sanitizeForApi((err as Error).message) },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/openclaw/chat/search — Save a recent search
// ============================================================================

export async function POST(request: NextRequest) {
  const csrf = checkCsrf(request);
  if (csrf) return csrf;

  try {
    const body = await request.json();
    const q = body.query;
    if (!q || typeof q !== "string" || !q.trim()) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }
    addRecentSearch(q.trim());
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Chat Search] Save recent failed:", (err as Error).message);
    return NextResponse.json(
      { error: sanitizeForApi((err as Error).message) },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE /api/openclaw/chat/search — Clear all recent searches
// ============================================================================

export async function DELETE(request: NextRequest) {
  const csrf = checkCsrf(request);
  if (csrf) return csrf;

  try {
    clearRecentSearches();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Chat Search] Clear recent failed:", (err as Error).message);
    return NextResponse.json(
      { error: sanitizeForApi((err as Error).message) },
      { status: 500 }
    );
  }
}
