import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import JSON5 from "json5";
import sharp from "sharp";
import { ensureGateway } from "@/lib/gateway-connection";
import { checkCsrf } from "@/lib/api-security";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB raw upload limit
const AVATAR_SIZE = 256; // px (square)
const MAX_OUTPUT_SIZE = 100 * 1024; // 100KB after processing

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

interface AgentConfig {
  id: string;
  workspace?: string;
  identity?: Record<string, unknown>;
  [key: string]: unknown;
}

interface OpenClawConfig {
  agents?: {
    list?: AgentConfig[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Resize and compress an avatar image to 256x256, under 100KB.
 */
async function processAvatar(input: Buffer): Promise<{ data: Buffer; ext: string }> {
  const processed = sharp(input)
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" });

  // Try PNG first (transparency support)
  let data = await processed.png({ quality: 80, compressionLevel: 9 }).toBuffer();
  if (data.length <= MAX_OUTPUT_SIZE) return { data, ext: ".png" };

  // WebP (better compression, keeps transparency)
  data = await processed.webp({ quality: 80 }).toBuffer();
  if (data.length <= MAX_OUTPUT_SIZE) return { data, ext: ".webp" };

  // JPEG with lower quality
  data = await processed.jpeg({ quality: 70 }).toBuffer();
  if (data.length <= MAX_OUTPUT_SIZE) return { data, ext: ".jpg" };

  // Last resort
  data = await processed.jpeg({ quality: 40 }).toBuffer();
  return { data, ext: ".jpg" };
}

/**
 * Find the OpenClaw config file path.
 */
function getOpenClawConfigPath(): string | null {
  const paths = [
    join(homedir(), ".openclaw", "openclaw.json"),
    join(homedir(), ".openclaw", "openclaw.json5"),
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * POST /api/openclaw/agents/[id]/avatar
 *
 * Upload a new avatar image for an agent.
 * - Resizes to 256x256 and compresses under 100KB
 * - Saves to the agent's workspace directory
 * - Writes config file directly (Gateway hot-reloads identity changes, no restart needed)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const { id: agentId } = await params;

  const safeId = agentId.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeId) {
    return NextResponse.json({ error: "Invalid agent ID" }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("avatar") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported format. Use PNG, JPEG, WebP, or GIF." },
      { status: 400 }
    );
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return NextResponse.json(
      { error: "File too large (max 5MB)" },
      { status: 400 }
    );
  }

  // Process image: resize to 256x256, compress to <100KB
  let processed: { data: Buffer; ext: string };
  try {
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    processed = await processAvatar(rawBuffer);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to process image: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 400 }
    );
  }

  // Read the OpenClaw config file directly
  const configPath = getOpenClawConfigPath();
  if (!configPath) {
    return NextResponse.json(
      { error: "OpenClaw config file not found" },
      { status: 500 }
    );
  }

  let config: OpenClawConfig;
  try {
    config = JSON5.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read config: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }

  const agents = config.agents?.list || [];
  const agent = agents.find((a) => a.id === safeId);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (!agent.workspace) {
    return NextResponse.json(
      { error: "Agent has no workspace configured" },
      { status: 400 }
    );
  }

  const workspacePath = agent.workspace.startsWith("~")
    ? join(homedir(), agent.workspace.slice(1))
    : agent.workspace;

  // Save processed avatar to workspace
  const avatarsDir = join(workspacePath, "avatars");
  const fileName = `avatar${processed.ext}`;
  const filePath = join(avatarsDir, fileName);

  try {
    mkdirSync(avatarsDir, { recursive: true, mode: 0o755 });
    writeFileSync(filePath, processed.data);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to save avatar: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }

  // Update config file directly — Gateway's file watcher hot-reloads identity changes
  // No config.patch, no restart, no WebSocket disconnect
  try {
    agent.identity = agent.identity || {};
    agent.identity.avatar = `avatars/${fileName}`;
    writeFileSync(configPath, JSON5.stringify(config, null, 2), "utf-8");
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to update config: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }

  // Wait briefly for Gateway's file watcher to hot-reload (~300ms debounce)
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Refresh Castle's agent list from the Gateway
  try {
    const gw = ensureGateway();
    if (gw.isConnected) {
      // Emit a signal so SSE clients re-fetch agents
      gw.emit("agentAvatarUpdated", { agentId: safeId });
    }
  } catch {
    // Non-critical
  }

  return NextResponse.json({
    success: true,
    avatar: `avatars/${fileName}`,
    size: processed.data.length,
    message: "Avatar updated",
  });
}
