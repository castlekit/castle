import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
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
 * POST /api/openclaw/agents/[id]/avatar
 *
 * Upload a new avatar image for an agent.
 * - Resizes to 256x256 and compresses under 100KB
 * - Saves to Castle's own avatars directory (~/.castle/avatars/)
 * - Updates OpenClaw config via Gateway's config.patch RPC (never writes to OpenClaw files directly)
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

  // Save processed avatar to Castle's own directory — never write to OpenClaw's filesystem
  const avatarsDir = join(homedir(), ".castle", "avatars");
  const fileName = `${safeId}${processed.ext}`;
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

  // Update OpenClaw config via Gateway's config.patch RPC — the proper way to
  // modify OpenClaw config without writing to its files directly.
  const gw = ensureGateway();

  if (!gw.isConnected) {
    // Avatar is saved locally; config update will happen when Gateway reconnects
    return NextResponse.json({
      success: true,
      avatar: filePath,
      size: processed.data.length,
      message: "Avatar saved locally. Gateway not connected — config will update when it reconnects.",
      configUpdated: false,
    });
  }

  try {
    // Use config.patch to set the agent's avatar path.
    // Gateway validates and applies the patch, then hot-reloads.
    await gw.request("config.patch", {
      agents: {
        list: [
          {
            id: safeId,
            identity: {
              avatar: filePath,
            },
          },
        ],
      },
    });
    console.log(`[Avatar API] Config patched for agent ${safeId}`);
  } catch (err) {
    console.error(
      `[Avatar API] config.patch failed for agent ${safeId}:`,
      err instanceof Error ? err.message : "unknown"
    );
    // Avatar is still saved locally — not a total failure
    return NextResponse.json({
      success: true,
      avatar: filePath,
      size: processed.data.length,
      message: "Avatar saved but config update failed. Try restarting the Gateway.",
      configUpdated: false,
    });
  }

  // Emit a signal so SSE clients re-fetch agents
  try {
    gw.emit("agentAvatarUpdated", { agentId: safeId });
  } catch {
    // Non-critical
  }

  return NextResponse.json({
    success: true,
    avatar: filePath,
    size: processed.data.length,
    message: "Avatar updated",
    configUpdated: true,
  });
}
