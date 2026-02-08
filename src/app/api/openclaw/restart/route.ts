import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { checkCsrf, checkRateLimit, rateLimitKey } from "@/lib/api-security";

export const dynamic = "force-dynamic";

/**
 * POST /api/openclaw/restart
 * Restart the OpenClaw Gateway process.
 * Protected against CSRF — only requests from the Castle UI are allowed.
 */
export async function POST(request: NextRequest) {
  const csrf = checkCsrf(request);
  if (csrf) return csrf;

  // Rate limit: 5 restarts per minute
  const rl = checkRateLimit(rateLimitKey(request, "restart"), 5);
  if (rl) return rl;

  try {
    // Try openclaw CLI restart first
    try {
      execSync("openclaw gateway restart", {
        timeout: 10000,
        stdio: "pipe",
      });
      return NextResponse.json({
        ok: true,
        method: "openclaw gateway restart",
      });
    } catch {
      // openclaw CLI not available or restart command failed
    }

    // Try stopping and starting via process signal
    try {
      const pids = execSync("pgrep -f 'openclaw.*gateway'", {
        timeout: 5000,
        stdio: "pipe",
      })
        .toString()
        .trim()
        .split(/\s+/)
        .filter((p) => /^\d+$/.test(p));

      const pid = pids[0];
      if (pid) {
        execSync(`kill -HUP ${pid}`, { timeout: 5000, stdio: "pipe" });
        return NextResponse.json({
          ok: true,
          method: "SIGHUP",
          pid: parseInt(pid, 10),
        });
      }
    } catch {
      // pgrep not available or no process found
    }

    return NextResponse.json(
      {
        ok: false,
        error:
          "Could not restart gateway. Try manually: openclaw gateway restart",
      },
      { status: 500 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Restart failed" },
      { status: 500 }
    );
  }
}
