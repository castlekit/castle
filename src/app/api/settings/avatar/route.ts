import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import sharp from "sharp";
import { setSetting } from "@/lib/db/queries";
import { checkCsrf, checkRateLimit, rateLimitKey } from "@/lib/api-security";

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

const AVATARS_DIR = join(homedir(), ".castle", "avatars");

/**
 * Resize and compress an avatar image to 256x256, under 100KB.
 */
async function processAvatar(input: Buffer): Promise<{ data: Buffer; ext: string }> {
  const processed = sharp(input).resize(AVATAR_SIZE, AVATAR_SIZE, {
    fit: "cover",
    position: "centre",
  });

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

// ============================================================================
// GET /api/settings/avatar — Serve user avatar
// ============================================================================

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function GET() {
  if (!existsSync(AVATARS_DIR)) {
    return new NextResponse(null, { status: 404 });
  }

  // Find user avatar file
  const files = readdirSync(AVATARS_DIR).filter((f) => f.startsWith("user."));
  if (files.length === 0) {
    return new NextResponse(null, { status: 404 });
  }

  const filePath = join(AVATARS_DIR, files[0]);
  const data = readFileSync(filePath);
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  const contentType = MIME_TYPES[ext] || "image/png";

  return new NextResponse(data, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=60",
    },
  });
}

// ============================================================================
// POST /api/settings/avatar — Upload user avatar
// ============================================================================

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  // Rate limit: 10 avatar uploads per minute
  const rl = checkRateLimit(rateLimitKey(request, "avatar:upload"), 10);
  if (rl) return rl;

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

  // Process image
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

  // Remove any existing user avatar files
  try {
    mkdirSync(AVATARS_DIR, { recursive: true, mode: 0o755 });
    if (existsSync(AVATARS_DIR)) {
      const existing = readdirSync(AVATARS_DIR).filter((f) => f.startsWith("user."));
      for (const f of existing) {
        unlinkSync(join(AVATARS_DIR, f));
      }
    }
  } catch {
    // silent
  }

  // Save new avatar
  const fileName = `user${processed.ext}`;
  const filePath = join(AVATARS_DIR, fileName);

  try {
    writeFileSync(filePath, processed.data);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to save avatar: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }

  // Store the avatar path with a version timestamp for cache-busting
  setSetting("avatarPath", `${fileName}?t=${Date.now()}`);

  return NextResponse.json({
    success: true,
    avatar: `/api/settings/avatar?t=${Date.now()}`,
    size: processed.data.length,
  });
}

// ============================================================================
// DELETE /api/settings/avatar — Remove user avatar
// ============================================================================

export async function DELETE(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  try {
    if (existsSync(AVATARS_DIR)) {
      const existing = readdirSync(AVATARS_DIR).filter((f) => f.startsWith("user."));
      for (const f of existing) {
        unlinkSync(join(AVATARS_DIR, f));
      }
    }
    setSetting("avatarPath", "");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to remove avatar: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }
}
