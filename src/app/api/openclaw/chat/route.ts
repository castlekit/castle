import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { checkCsrf, sanitizeForApi, checkRateLimit, rateLimitKey } from "@/lib/api-security";
import { ensureGateway } from "@/lib/gateway-connection";
import {
  createMessage,
  updateMessage,
  deleteMessage,
  getMessagesByChannel,
  getMessagesAfter,
  getMessagesAround,
  getMessageByRunId,
  getLatestSessionKey,
  createSession,
} from "@/lib/db/queries";
import type { ChatSendRequest, ChatCompleteRequest } from "@/lib/types/chat";

const MAX_MESSAGE_LENGTH = 32768; // 32KB

// ============================================================================
// POST /api/openclaw/chat — Send a message
// ============================================================================

export async function POST(request: NextRequest) {
  const _start = Date.now();
  const csrf = checkCsrf(request);
  if (csrf) return csrf;

  // Rate limit: 30 messages per minute
  const rl = checkRateLimit(rateLimitKey(request, "chat:send"), 30);
  if (rl) {
    console.warn("[Chat API] Rate limited on chat:send");
    return rl;
  }

  let body: ChatSendRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validate
  if (!body.channelId || typeof body.channelId !== "string") {
    return NextResponse.json({ error: "channelId is required" }, { status: 400 });
  }
  if (!body.content || typeof body.content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (body.content.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` },
      { status: 400 }
    );
  }

  // Persist user message to DB
  const userMsg = createMessage({
    channelId: body.channelId,
    senderType: "user",
    senderId: "local-user",
    senderName: "You",
    content: body.content,
    mentionedAgentId: body.agentId,
  });

  try {
    const gateway = ensureGateway();

    // Get existing session key for this channel (if any)
    let sessionKey = getLatestSessionKey(body.channelId);

    // If no existing session, create one with a proper structured key:
    //   agent:<agentId>:castle:<channelId>
    // This maps Castle channels to Gateway sessions 1:1, so the session
    // is stable and traceable between Castle DB and Gateway transcripts.
    if (!sessionKey) {
      const agentId = body.agentId || "main";
      sessionKey = `agent:${agentId}:castle:${body.channelId}`;

      createSession({
        channelId: body.channelId,
        sessionKey,
      });
    }

    // Build chat.send params per Gateway protocol
    const rpcParams: Record<string, unknown> = {
      message: body.content,
      sessionKey,
      idempotencyKey: randomUUID(),
      timeoutMs: 120000,
    };

    const result = await gateway.request<{
      runId: string;
      status?: string;
    }>("chat.send", rpcParams);

    // Update user message with runId and sessionKey
    const runId = result.runId;
    updateMessage(userMsg.id, {
      runId,
      sessionKey,
    });

    console.log(`[Chat API] POST send OK — runId=${runId} channel=${body.channelId} (${Date.now() - _start}ms)`);
    return NextResponse.json({
      runId,
      messageId: userMsg.id,
      sessionKey,
    });
  } catch (err) {
    // RPC failed — try to remove the optimistic user message
    try {
      deleteMessage(userMsg.id);
    } catch (delErr) {
      console.error("[Chat API] Cleanup of optimistic message failed:", (delErr as Error).message);
    }
    console.error(`[Chat API] POST send FAILED — channel=${body.channelId} (${Date.now() - _start}ms):`, (err as Error).message);
    return NextResponse.json(
      { error: sanitizeForApi((err as Error).message) },
      { status: 502 }
    );
  }
}

// ============================================================================
// PUT /api/openclaw/chat — Complete/update an agent message
// ============================================================================

export async function PUT(request: NextRequest) {
  const _start = Date.now();
  const csrf = checkCsrf(request);
  if (csrf) return csrf;

  let body: ChatCompleteRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.runId || !body.channelId || !body.content) {
    return NextResponse.json(
      { error: "runId, channelId, and content are required" },
      { status: 400 }
    );
  }

  try {
    // Check if we already have a message for this runId (from a previous partial save)
    const existing = getMessageByRunId(body.runId);

    if (existing) {
      // Already complete with same content — idempotent, skip update to avoid
      // triggering FTS5 update trigger with identical content (causes SQL error)
      if (existing.status === "complete" && existing.content === body.content) {
        return NextResponse.json({ messageId: existing.id, updated: false });
      }

      // Update existing message (e.g. partial → complete, or content changed)
      updateMessage(existing.id, {
        content: body.content,
        status: body.status,
        sessionKey: body.sessionKey,
        inputTokens: body.inputTokens,
        outputTokens: body.outputTokens,
      });
      return NextResponse.json({ messageId: existing.id, updated: true });
    }

    // Create new agent message
    const agentMsg = createMessage({
      channelId: body.channelId,
      senderType: "agent",
      senderId: body.agentId,
      senderName: body.agentName,
      content: body.content,
      status: body.status,
      runId: body.runId,
      sessionKey: body.sessionKey,
      inputTokens: body.inputTokens,
      outputTokens: body.outputTokens,
    });

    console.log(`[Chat API] PUT complete OK — runId=${body.runId} new msg=${agentMsg.id} (${Date.now() - _start}ms)`);
    return NextResponse.json({ messageId: agentMsg.id, updated: false });
  } catch (err) {
    console.error(`[Chat API] PUT complete FAILED — runId=${body.runId} (${Date.now() - _start}ms):`, (err as Error).message);
    return NextResponse.json(
      { error: sanitizeForApi((err as Error).message) },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE /api/openclaw/chat — Abort streaming
// ============================================================================

export async function DELETE(request: NextRequest) {
  const csrf = checkCsrf(request);
  if (csrf) return csrf;

  console.log("[Chat API] DELETE abort requested");
  try {
    const gateway = ensureGateway();
    await gateway.request("chat.abort", {});
    console.log("[Chat API] DELETE abort OK");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Chat API] DELETE abort FAILED:", (err as Error).message);
    return NextResponse.json(
      { error: sanitizeForApi((err as Error).message) },
      { status: 502 }
    );
  }
}

// ============================================================================
// GET /api/openclaw/chat?channelId=X&limit=50&before=Y — Load history
//   ?around=msgId — Load a window centered on a specific message
//   ?after=msgId  — Forward pagination (newer messages)
//   ?before=msgId — Backward pagination (older messages, existing)
// ============================================================================

export async function GET(request: NextRequest) {
  const _start = Date.now();
  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
  const around = searchParams.get("around") || undefined;
  const after = searchParams.get("after") || undefined;
  const before = searchParams.get("before") || undefined;

  if (!channelId) {
    return NextResponse.json({ error: "channelId is required" }, { status: 400 });
  }

  try {
    // Anchor mode: load a window of messages around a specific message
    if (around) {
      const result = getMessagesAround(channelId, around, limit);
      if (!result) {
        // Anchor message not found — fall back to latest messages
        const msgs = getMessagesByChannel(channelId, limit);
        return NextResponse.json({
          messages: msgs,
          hasMore: msgs.length === limit,
        });
      }
      return NextResponse.json({
        messages: result.messages,
        hasMoreBefore: result.hasMoreBefore,
        hasMoreAfter: result.hasMoreAfter,
      });
    }

    // Forward pagination: load messages newer than cursor
    if (after) {
      const msgs = getMessagesAfter(channelId, after, limit);
      return NextResponse.json({
        messages: msgs,
        hasMore: msgs.length === limit,
      });
    }

    // Default / backward pagination
    const msgs = getMessagesByChannel(channelId, limit, before);
    console.log(`[Chat API] GET history OK — channel=${channelId} msgs=${msgs.length} (${Date.now() - _start}ms)`);
    return NextResponse.json({
      messages: msgs,
      hasMore: msgs.length === limit,
    });
  } catch (err) {
    console.error(`[Chat API] GET history FAILED — channel=${channelId} (${Date.now() - _start}ms):`, (err as Error).message);
    return NextResponse.json(
      { error: sanitizeForApi((err as Error).message) },
      { status: 500 }
    );
  }
}
