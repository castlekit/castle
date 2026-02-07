import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
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
  const file = searchParams.get("file")?.trim() || "gateway";

  const logsDir = join(getOpenClawDir(), "logs");

  if (!existsSync(logsDir)) {
    return NextResponse.json({ logs: [], error: "No logs directory found" });
  }

  // List available log files
  const availableFiles = existsSync(logsDir)
    ? readdirSync(logsDir).filter((f) => f.endsWith(".log"))
    : [];

  // Find matching log file
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
