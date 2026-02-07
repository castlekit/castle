import { NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, basename } from "path";
import { getOpenClawDir } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/openclaw/sessions
 * God mode: reads session files directly from ~/.openclaw/ filesystem.
 * Returns a list of sessions with basic metadata.
 */
export async function GET() {
  const openclawDir = getOpenClawDir();
  const agentsDir = join(openclawDir, "agents");

  if (!existsSync(agentsDir)) {
    return NextResponse.json({ sessions: [] });
  }

  try {
    const sessions: Array<{
      agentId: string;
      sessionId: string;
      file: string;
      sizeBytes: number;
      modifiedAt: string;
    }> = [];

    // Scan all agent directories
    const agentDirs = readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const agentDir of agentDirs) {
      const sessionsDir = join(agentsDir, agentDir.name, "sessions");
      if (!existsSync(sessionsDir)) continue;

      const files = readdirSync(sessionsDir)
        .filter((f) => f.endsWith(".jsonl"));

      for (const file of files) {
        const filePath = join(sessionsDir, file);
        const stat = statSync(filePath);
        sessions.push({
          agentId: agentDir.name,
          sessionId: basename(file, ".jsonl"),
          file: filePath,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }

    // Sort by most recently modified
    sessions.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

    return NextResponse.json({ sessions });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read sessions" },
      { status: 500 }
    );
  }
}
