import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { platform } from "os";
import { v4 as uuid } from "uuid";
import { checkCsrf } from "@/lib/api-security";
import { getCastleDir } from "@/lib/config";
import { createAttachment, getAttachmentsByMessage } from "@/lib/db/queries";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
]);

function getAttachmentsDir(): string {
  return join(getCastleDir(), "data", "attachments");
}

/** Validate that resolved path stays within the attachments directory */
function isPathSafe(filePath: string, baseDir: string): boolean {
  const resolved = resolve(filePath);
  const resolvedBase = resolve(baseDir);
  return resolved.startsWith(resolvedBase);
}

function getMimeForExt(ext: string): string {
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
  };
  return map[ext.toLowerCase()] || "application/octet-stream";
}

// ============================================================================
// POST /api/openclaw/chat/attachments — Upload attachment
// ============================================================================

export async function POST(request: NextRequest) {
  const csrf = checkCsrf(request);
  if (csrf) return csrf;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const channelId = formData.get("channelId") as string | null;
  const messageId = formData.get("messageId") as string | null;

  if (!file || !channelId) {
    return NextResponse.json(
      { error: "file and channelId are required" },
      { status: 400 }
    );
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` },
      { status: 400 }
    );
  }

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}` },
      { status: 400 }
    );
  }

  try {
    // Determine file extension from MIME type
    const extMap: Record<string, string> = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "audio/mpeg": ".mp3",
      "audio/ogg": ".ogg",
      "audio/wav": ".wav",
    };
    const ext = extMap[file.type] || ".bin";

    // Create UUID-based filename (never use user-supplied names)
    const filename = `${uuid()}${ext}`;
    const channelDir = join(getAttachmentsDir(), channelId);

    // Ensure directory exists
    if (!existsSync(channelDir)) {
      mkdirSync(channelDir, { recursive: true, mode: 0o700 });
    }

    const filePath = join(channelDir, filename);

    // Path traversal check
    if (!isPathSafe(filePath, getAttachmentsDir())) {
      return NextResponse.json(
        { error: "Invalid path" },
        { status: 400 }
      );
    }

    // Write file
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(filePath, buffer);

    // Secure permissions
    if (platform() !== "win32") {
      try {
        const { chmodSync } = await import("fs");
        chmodSync(filePath, 0o600);
      } catch {
        // May fail on some filesystems
      }
    }

    // Persist to DB (if messageId provided)
    const attachmentType = file.type.startsWith("image/") ? "image" : "audio";
    let attachmentRecord = null;

    if (messageId) {
      attachmentRecord = createAttachment({
        messageId,
        attachmentType: attachmentType as "image" | "audio",
        filePath: `${channelId}/${filename}`,
        mimeType: file.type,
        fileSize: file.size,
        originalName: file.name,
      });
    }

    return NextResponse.json({
      id: attachmentRecord?.id ?? uuid(),
      filePath: `${channelId}/${filename}`,
      mimeType: file.type,
      fileSize: file.size,
      originalName: file.name,
    }, { status: 201 });
  } catch (err) {
    console.error("[Attachments] Upload failed:", (err as Error).message);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET /api/openclaw/chat/attachments?path=... — Serve attachment
// ============================================================================

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get("path");
  const messageId = searchParams.get("messageId");

  // If messageId provided, return all attachments for that message
  if (messageId) {
    try {
      const attachments = getAttachmentsByMessage(messageId);
      return NextResponse.json({ attachments });
    } catch (err) {
      console.error("[Attachments] List failed:", (err as Error).message);
      return NextResponse.json(
        { error: "Failed to list attachments" },
        { status: 500 }
      );
    }
  }

  // Serve individual file
  if (!filePath) {
    return NextResponse.json(
      { error: "path or messageId parameter required" },
      { status: 400 }
    );
  }

  const baseDir = getAttachmentsDir();
  const fullPath = join(baseDir, filePath);

  // Path traversal check
  if (!isPathSafe(fullPath, baseDir)) {
    return NextResponse.json(
      { error: "Invalid path" },
      { status: 400 }
    );
  }

  if (!existsSync(fullPath)) {
    return NextResponse.json(
      { error: "Attachment not found" },
      { status: 404 }
    );
  }

  try {
    const data = readFileSync(fullPath);
    const ext = fullPath.substring(fullPath.lastIndexOf("."));
    const mimeType = getMimeForExt(ext);
    const stat = statSync(fullPath);

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(stat.size),
        "Content-Disposition": "inline",
        "Cache-Control": "public, max-age=86400", // 24h cache
      },
    });
  } catch (err) {
    console.error("[Attachments] Serve failed:", (err as Error).message);
    return NextResponse.json(
      { error: "Failed to serve attachment" },
      { status: 500 }
    );
  }
}
