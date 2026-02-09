import { NextRequest, NextResponse } from "next/server";
import { checkCsrf, sanitizeForApi } from "@/lib/api-security";
import {
  createChannel,
  getChannels,
  getChannel,
  updateChannel,
  deleteChannel,
  archiveChannel,
  restoreChannel,
  touchChannel,
  getLastAccessedChannelId,
} from "@/lib/db/queries";

const MAX_CHANNEL_NAME_LENGTH = 100;

/** Strip control characters from a string (keep printable + whitespace) */
function sanitizeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}

/** Validate agent ID format */
function isValidAgentId(id: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(id);
}

// ============================================================================
// GET /api/openclaw/chat/channels — List channels
// ============================================================================

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  try {
    // GET /api/openclaw/chat/channels?last=1 — get last accessed channel ID
    if (searchParams.get("last")) {
      const lastId = getLastAccessedChannelId();
      return NextResponse.json({ channelId: lastId });
    }

    const archived = searchParams.get("archived") === "1";
    const all = getChannels(archived);
    return NextResponse.json({ channels: all });
  } catch (err) {
    console.error("[Chat Channels] List failed:", (err as Error).message);
    return NextResponse.json(
      { error: sanitizeForApi((err as Error).message) },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/openclaw/chat/channels — Create / update / delete channel
// ============================================================================

export async function POST(request: NextRequest) {
  const csrf = checkCsrf(request);
  if (csrf) return csrf;

  let body: {
    action?: "create" | "update" | "delete" | "archive" | "restore" | "touch";
    id?: string;
    name?: string;
    defaultAgentId?: string;
    agents?: string[];
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action || "create";

  // ------ TOUCH (mark as last accessed) ------
  if (action === "touch") {
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    touchChannel(body.id);
    return NextResponse.json({ ok: true });
  }

  // ------ ARCHIVE ------
  if (action === "archive") {
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const archived = archiveChannel(body.id);
    if (!archived) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  // ------ RESTORE ------
  if (action === "restore") {
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const restored = restoreChannel(body.id);
    if (!restored) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  // ------ DELETE (permanent — only for archived channels) ------
  if (action === "delete") {
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    // Only allow deleting archived channels
    const ch = getChannel(body.id);
    if (!ch) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    if (!ch.archivedAt) {
      return NextResponse.json(
        { error: "Channel must be archived before it can be permanently deleted" },
        { status: 400 }
      );
    }
    try {
      const deleted = deleteChannel(body.id);
      if (!deleted) {
        return NextResponse.json({ error: "Channel not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("[Chat Channels] Delete failed:", (err as Error).message);
      return NextResponse.json(
        { error: sanitizeForApi((err as Error).message) },
        { status: 500 }
      );
    }
  }

  // ------ UPDATE ------
  if (action === "update") {
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const updates: { name?: string; defaultAgentId?: string } = {};
    if (body.name) {
      const cleanName = sanitizeName(body.name);
      if (!cleanName || cleanName.length > MAX_CHANNEL_NAME_LENGTH) {
        return NextResponse.json(
          { error: `Channel name must be 1-${MAX_CHANNEL_NAME_LENGTH} characters` },
          { status: 400 }
        );
      }
      updates.name = cleanName;
    }
    if (body.defaultAgentId) {
      if (!isValidAgentId(body.defaultAgentId)) {
        return NextResponse.json({ error: "Invalid agent ID format" }, { status: 400 });
      }
      updates.defaultAgentId = body.defaultAgentId;
    }
    const updated = updateChannel(body.id, updates);
    if (!updated) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    const channel = getChannel(body.id);
    return NextResponse.json({ channel });
  }

  // ------ CREATE ------
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!body.defaultAgentId || typeof body.defaultAgentId !== "string") {
    return NextResponse.json({ error: "defaultAgentId is required" }, { status: 400 });
  }

  const cleanName = sanitizeName(body.name);
  if (!cleanName || cleanName.length > MAX_CHANNEL_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Channel name must be 1-${MAX_CHANNEL_NAME_LENGTH} characters` },
      { status: 400 }
    );
  }

  if (!isValidAgentId(body.defaultAgentId)) {
    return NextResponse.json({ error: "Invalid agent ID format" }, { status: 400 });
  }

  // Validate all agent IDs
  if (body.agents) {
    for (const agentId of body.agents) {
      if (!isValidAgentId(agentId)) {
        return NextResponse.json(
          { error: `Invalid agent ID format: ${agentId}` },
          { status: 400 }
        );
      }
    }
  }

  try {
    const channel = createChannel(cleanName, body.defaultAgentId, body.agents);
    return NextResponse.json({ channel }, { status: 201 });
  } catch (err) {
    console.error("[Chat Channels] Create failed:", (err as Error).message);
    return NextResponse.json(
      { error: sanitizeForApi((err as Error).message) },
      { status: 500 }
    );
  }
}
