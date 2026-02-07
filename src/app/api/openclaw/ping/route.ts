import { NextResponse } from "next/server";
import { ensureGateway } from "@/lib/gateway-connection";

export const dynamic = "force-dynamic";

/**
 * POST /api/openclaw/ping
 * Health check -- tests connection to OpenClaw Gateway
 */
export async function POST() {
  const gw = ensureGateway();

  if (!gw.isConfigured) {
    return NextResponse.json({
      ok: false,
      configured: false,
      error: "No OpenClaw token found. Run 'castle setup' or check ~/.openclaw/openclaw.json",
    });
  }

  // If not connected yet, give it a moment to complete handshake
  if (gw.state === "connecting") {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 5000);
      const onState = () => {
        clearTimeout(timeout);
        gw.off("stateChange", onState);
        resolve();
      };
      gw.on("stateChange", onState);
    });
  }

  if (!gw.isConnected) {
    return NextResponse.json({
      ok: false,
      configured: true,
      state: gw.state,
      error: gw.state === "error"
        ? "Failed to connect to OpenClaw Gateway. Is it running?"
        : "Connecting to OpenClaw Gateway...",
    });
  }

  try {
    const start = Date.now();
    await gw.request("health", {});
    const latency = Date.now() - start;

    return NextResponse.json({
      ok: true,
      configured: true,
      latency_ms: latency,
      server: gw.serverInfo,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      configured: true,
      error: err instanceof Error ? err.message : "Health check failed",
    });
  }
}

// Allow GET for easy status checks
export async function GET() {
  return POST();
}
