import { NextRequest, NextResponse } from "next/server";
import { sanitizeForApi } from "@/lib/api-security";
import { searchMessages } from "@/lib/db/queries";

const MAX_QUERY_LENGTH = 500;

// ============================================================================
// GET /api/openclaw/chat/search?q=X&channelId=X — Full-text search
// ============================================================================

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const channelId = searchParams.get("channelId") || undefined;
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
    const results = searchMessages(q, channelId, limit);
    return NextResponse.json({ results });
  } catch (err) {
    console.error("[Chat Search] Failed:", (err as Error).message);
    return NextResponse.json(
      { error: sanitizeForApi((err as Error).message) },
      { status: 500 }
    );
  }
}
