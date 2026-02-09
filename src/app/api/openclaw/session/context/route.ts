import { NextRequest, NextResponse } from "next/server";
import { ensureGateway } from "@/lib/gateway-connection";
import { sanitizeForApi } from "@/lib/api-security";
import {
  getCompactionBoundary,
  setCompactionBoundary,
} from "@/lib/db/queries";

// ============================================================================
// Types
// ============================================================================

interface PreviewMessage {
  role: string;
  content?: string;
  timestamp?: number;
}

interface PreviewResponse {
  messages?: PreviewMessage[];
  entries?: PreviewMessage[];
}

interface ContextBoundaryResponse {
  /** ID of the oldest message still in the agent's context. Null if unknown. */
  boundaryMessageId: string | null;
  /** Whether the boundary was freshly determined (true) or loaded from cache (false). */
  fresh: boolean;
}

// ============================================================================
// GET /api/openclaw/session/context?sessionKey=X&channelId=Y
//
// Determines the compaction boundary: which messages the agent can "see".
// Calls sessions.preview on the Gateway, matches against local DB, caches result.
// ============================================================================

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionKey = searchParams.get("sessionKey");
  const channelId = searchParams.get("channelId");

  if (!sessionKey) {
    return NextResponse.json(
      { error: "sessionKey is required" },
      { status: 400 }
    );
  }

  try {
    // First, check cached boundary
    const cached = getCompactionBoundary(sessionKey);

    // Try to get fresh boundary from Gateway
    const gateway = ensureGateway();
    let fresh = false;
    let boundaryMessageId = cached;

    try {
      const preview = await gateway.request<PreviewResponse>(
        "sessions.preview",
        {
          keys: [sessionKey],
          limit: 100,
          maxChars: 20000,
        }
      );

      // The preview returns messages that the agent can currently see.
      // Find the oldest message in the preview to determine the boundary.
      const previewMessages = preview.messages || preview.entries || [];

      if (previewMessages.length > 0 && channelId) {
        // Import dynamically to avoid circular deps
        const { getDb } = await import("@/lib/db/index");
        const { messages } = await import("@/lib/db/schema");
        const { eq, asc } = await import("drizzle-orm");

        const db = getDb();

        // Get oldest message timestamp from preview
        const oldestPreview = previewMessages[0];
        const oldestTimestamp = oldestPreview?.timestamp;

        if (oldestTimestamp) {
          // Find the Castle message closest to this timestamp
          const localMessages = db
            .select({ id: messages.id, createdAt: messages.createdAt })
            .from(messages)
            .where(eq(messages.channelId, channelId))
            .orderBy(asc(messages.createdAt))
            .all();

          // Find the message with timestamp closest to the oldest preview message
          let closestId: string | null = null;
          let closestDiff = Infinity;
          for (const msg of localMessages) {
            const diff = Math.abs(msg.createdAt - oldestTimestamp);
            if (diff < closestDiff) {
              closestDiff = diff;
              closestId = msg.id;
            }
          }

          if (closestId && closestDiff < 60000) {
            // Match within 60s tolerance
            boundaryMessageId = closestId;
            fresh = true;

            // Cache it in the DB
            setCompactionBoundary(sessionKey, closestId);
          }
        }
      }
    } catch (previewErr) {
      // sessions.preview might not be available — fall back to cached
      console.warn(
        "[Session Context] sessions.preview failed, using cached boundary:",
        (previewErr as Error).message
      );
    }

    const response: ContextBoundaryResponse = {
      boundaryMessageId,
      fresh,
    };

    return NextResponse.json(response);
  } catch (err) {
    const message = (err as Error).message;
    console.error("[Session Context] Failed:", message);
    return NextResponse.json(
      { error: sanitizeForApi(message) },
      { status: 502 }
    );
  }
}

// ============================================================================
// POST /api/openclaw/session/context — Update boundary after compaction event
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionKey, boundaryMessageId } = body;

    if (!sessionKey || !boundaryMessageId) {
      return NextResponse.json(
        { error: "sessionKey and boundaryMessageId are required" },
        { status: 400 }
      );
    }

    setCompactionBoundary(sessionKey, boundaryMessageId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
