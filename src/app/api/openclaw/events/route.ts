import { ensureGateway, type GatewayEvent } from "@/lib/gateway-connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Strip sensitive fields (tokens, keys) from event payloads
 * before forwarding to the browser.
 */
function redactEventPayload(evt: GatewayEvent): GatewayEvent {
  if (!evt.payload || typeof evt.payload !== "object") return evt;

  const payload = { ...(evt.payload as Record<string, unknown>) };

  // Redact deviceToken from pairing events
  if (typeof payload.deviceToken === "string") {
    payload.deviceToken = "[REDACTED]";
  }
  // Redact nested auth.deviceToken
  if (payload.auth && typeof payload.auth === "object") {
    const auth = { ...(payload.auth as Record<string, unknown>) };
    if (typeof auth.deviceToken === "string") auth.deviceToken = "[REDACTED]";
    if (typeof auth.token === "string") auth.token = "[REDACTED]";
    payload.auth = auth;
  }
  // Redact any top-level token field
  if (typeof payload.token === "string") {
    payload.token = "[REDACTED]";
  }

  return { ...evt, payload };
}

/**
 * GET /api/openclaw/events
 * SSE endpoint -- streams OpenClaw Gateway events to the browser in real-time.
 * Browser connects once via EventSource and receives push updates.
 */
export async function GET() {
  const gw = ensureGateway();

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial state
      const initial = {
        event: "castle.state",
        payload: {
          state: gw.state,
          isConnected: gw.isConnected,
          server: gw.serverInfo,
        },
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initial)}\n\n`));

      // Forward gateway events (with sensitive fields redacted)
      const onGatewayEvent = (evt: GatewayEvent) => {
        if (closed) return;
        try {
          // ── DIAGNOSTIC LOGGING (remove after debugging) ──────────────
          if (evt.event === "chat") {
            const p = evt.payload as Record<string, unknown> | undefined;
            console.log(
              `[SSE-SERVER-DIAG] chat event: state=${p?.state} runId=${String(p?.runId ?? "").slice(0, 8)} seq=${evt.seq ?? p?.seq} textLen=${String(p?.text ?? "").length}`
            );
          }
          // ── END DIAGNOSTIC ───────────────────────────────────────────
          const safe = redactEventPayload(evt);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(safe)}\n\n`));
        } catch {
          // Stream may have closed
        }
      };

      // Forward state changes
      const onStateChange = (state: string) => {
        if (closed) return;
        try {
          const msg = {
            event: "castle.state",
            payload: {
              state,
              isConnected: gw.isConnected,
              server: gw.serverInfo,
            },
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
        } catch {
          // Stream may have closed
        }
      };

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          // Stream may have closed
        }
      }, 30000);

      gw.on("gatewayEvent", onGatewayEvent);
      gw.on("stateChange", onStateChange);

      // Cleanup when the client disconnects
      const cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        gw.off("gatewayEvent", onGatewayEvent);
        gw.off("stateChange", onStateChange);
      };

      // The stream's cancel is called when the client disconnects
      // We store cleanup for the cancel callback
      (controller as unknown as { _cleanup: () => void })._cleanup = cleanup;
    },
    cancel(controller) {
      const cleanup = (controller as unknown as { _cleanup: () => void })._cleanup;
      if (cleanup) cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
