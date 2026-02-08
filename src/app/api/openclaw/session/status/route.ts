import { NextRequest, NextResponse } from "next/server";
import { ensureGateway } from "@/lib/gateway-connection";
import { sanitizeForApi } from "@/lib/api-security";
import type { SessionStatus } from "@/lib/types/chat";

// ============================================================================
// GET /api/openclaw/session/status?sessionKey=X — Session stats
// ============================================================================

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionKey = searchParams.get("sessionKey");

  if (!sessionKey) {
    return NextResponse.json(
      { error: "sessionKey is required" },
      { status: 400 }
    );
  }

  try {
    const gateway = ensureGateway();
    const result = await gateway.request<SessionStatus>("session.status", {
      sessionKey,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = (err as Error).message;

    // Session not found is not an error — just return empty
    if (message.includes("not found") || message.includes("unknown")) {
      return new NextResponse(null, { status: 204 });
    }

    console.error("[Session Status] Failed:", message);
    return NextResponse.json(
      { error: sanitizeForApi(message) },
      { status: 502 }
    );
  }
}
