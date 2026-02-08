import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { getOpenClawDir } from "@/lib/config";
import { sanitizeForApi } from "@/lib/api-security";

export const dynamic = "force-dynamic";

/**
 * GET /api/openclaw/logs?lines=100&file=gateway
 * God mode: reads log files from ~/.openclaw/logs/
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawLines = parseInt(searchParams.get("lines") || "100", 10);
  const lines = Math.min(Math.max(1, Number.isFinite(rawLines) ? rawLines : 100), 10000);
  const rawFile = searchParams.get("file")?.trim() || "gateway";

  // Sanitize file parameter: only allow alphanumeric, hyphens, underscores, dots
  // Reject anything with path separators or traversal patterns
  const file = rawFile.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!file || file.includes("..") || file !== rawFile) {
    return NextResponse.json(
      { error: "Invalid log file name" },
      { status: 400 }
    );
  }

  const logsDir = join(getOpenClawDir(), "logs");

  if (!existsSync(logsDir)) {
    return NextResponse.json({ logs: [], error: "No logs directory found" });
  }

  // List available log files
  const availableFiles = existsSync(logsDir)
    ? readdirSync(logsDir).filter((f) => f.endsWith(".log"))
    : [];

  // Find matching log file — must match prefix exactly within the logs directory
  const logFile = availableFiles.find((f) => f.startsWith(file));
  if (!logFile) {
    return NextResponse.json({
      logs: [],
      available: availableFiles,
      error: `Log file '${file}' not found`,
    });
  }

  try {
    const logPath = join(logsDir, logFile);
    // Final safety check: resolved path must be inside the logs directory
    if (!resolve(logPath).startsWith(resolve(logsDir))) {
      return NextResponse.json({ error: "Invalid log file path" }, { status: 400 });
    }
    const content = readFileSync(logPath, "utf-8");
    const allLines = content.split("\n").filter(Boolean);

    // Return last N lines, sanitized to strip tokens/keys
    const tailLines = allLines.slice(-lines).map(sanitizeForApi);

    return NextResponse.json({
      logs: tailLines,
      file: logFile,
      totalLines: allLines.length,
      available: availableFiles,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read logs" },
      { status: 500 }
    );
  }
}
