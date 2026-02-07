import { NextResponse } from "next/server";
import { execSync } from "child_process";

export const dynamic = "force-dynamic";

/**
 * POST /api/openclaw/restart
 * God mode: restart the OpenClaw Gateway process.
 * Tries common methods to restart the gateway.
 */
export async function POST() {
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
      const pid = execSync("pgrep -f 'openclaw.*gateway'", {
        timeout: 5000,
        stdio: "pipe",
      })
        .toString()
        .trim();

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
