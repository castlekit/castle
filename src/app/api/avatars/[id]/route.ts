import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const dynamic = "force-dynamic";

const AVATAR_DIRS = [
  join(homedir(), ".castle", "avatars"),
  join(homedir(), ".openclaw", "avatars"),
];

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/**
 * GET /api/avatars/[id]
 * Serves avatar images from ~/.castle/avatars/ or ~/.openclaw/avatars/
 * Supports IDs with or without extension (tries .png, .jpg, .webp)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Sanitize -- prevent path traversal
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeId || safeId.includes("..")) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Try each avatar directory
  for (const dir of AVATAR_DIRS) {
    if (!existsSync(dir)) continue;

    // Try exact filename first (if it has an extension)
    const hasExtension = /\.\w+$/.test(safeId);
    if (hasExtension) {
      const filePath = join(dir, safeId);
      if (existsSync(filePath)) {
        return serveFile(filePath);
      }
    }

    // Try common extensions
    for (const ext of [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]) {
      const filePath = join(dir, `${safeId}${ext}`);
      if (existsSync(filePath)) {
        return serveFile(filePath);
      }
    }
  }

  return new NextResponse("Not found", { status: 404 });
}

function serveFile(filePath: string): NextResponse {
  const data = readFileSync(filePath);
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new NextResponse(data, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
