import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { ensureGateway } from "@/lib/gateway-connection";

export const dynamic = "force-dynamic";

const EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const CACHE_HEADERS = { "Cache-Control": "public, max-age=3600" };

/**
 * GET /api/avatars/[id]
 *
 * Proxies avatar images so they work from any device (mobile, Tailscale, etc).
 *
 * Resolution order:
 *   1. Stored URL from Gateway → workspace path or HTTP fetch
 *   2. Local file in ~/.castle/avatars/ or ~/.openclaw/avatars/
 *   3. 404
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Sanitize
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeId || safeId.includes("..")) {
    return new NextResponse("Not found", { status: 404 });
  }

  // 1. Try stored URL from Gateway
  try {
    const gw = ensureGateway();
    const storedUrl = gw.getAvatarUrl(safeId);

    if (storedUrl) {
      // Workspace-relative: workspace:///absolute/path/to/workspace/avatars/file.png
      if (storedUrl.startsWith("workspace://")) {
        const pathPart = storedUrl.slice("workspace://".length);
        // Resolve ~ in workspace path
        const resolved = pathPart.startsWith("~")
          ? join(homedir(), pathPart.slice(1))
          : pathPart;
        // Prevent traversal
        if (!resolved.includes("..") && existsSync(resolved)) {
          return serveFile(resolved);
        }
      }
      // HTTP(S) URL: fetch server-side and proxy
      else if (storedUrl.startsWith("http://") || storedUrl.startsWith("https://")) {
        const response = await fetchAvatar(storedUrl);
        if (response) return response;
      }
    }
  } catch {
    // Gateway unavailable
  }

  // 2. Local avatar directories
  const localDirs = [
    join(homedir(), ".castle", "avatars"),
    join(homedir(), ".openclaw", "avatars"),
  ];

  for (const dir of localDirs) {
    if (!existsSync(dir)) continue;

    if (/\.\w+$/.test(safeId)) {
      const filePath = join(dir, safeId);
      if (existsSync(filePath)) return serveFile(filePath);
    }

    for (const ext of EXTENSIONS) {
      const filePath = join(dir, `${safeId}${ext}`);
      if (existsSync(filePath)) return serveFile(filePath);
    }
  }

  return new NextResponse("Not found", { status: 404 });
}

/** Fetch an avatar from an HTTP URL with a short timeout */
async function fetchAvatar(url: string): Promise<NextResponse | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) return null;

    const contentType = resp.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) return null;

    const data = Buffer.from(await resp.arrayBuffer());
    return new NextResponse(data, {
      headers: { "Content-Type": contentType, ...CACHE_HEADERS },
    });
  } catch {
    return null;
  }
}

/** Serve a local file with appropriate content type */
function serveFile(filePath: string): NextResponse {
  const data = readFileSync(filePath);
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new NextResponse(data, {
    headers: { "Content-Type": contentType, ...CACHE_HEADERS },
  });
}
