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
export async function GET(request: Request) {
  const gw = ensureGateway();

  const encoder = new TextEncoder();
  let closed = false;
  const connectedAt = Date.now();
  let eventCount = 0;

  console.log(`[SSE] Client connected (gateway: ${gw.state})`);

  // Use the request's AbortSignal as the primary cleanup mechanism.
  // ReadableStream.cancel() is unreliable in some environments.
  const signal = request.signal;

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
        eventCount++;
        try {
          const safe = redactEventPayload(evt);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(safe)}\n\n`));
        } catch (err) {
          console.warn(`[SSE] Stream write failed for event ${evt.event}:`, (err as Error).message);
          cleanup();
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
          cleanup();
        }
      };

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          cleanup();
        }
      }, 30000);

      gw.on("gatewayEvent", onGatewayEvent);
      gw.on("stateChange", onStateChange);

      // Cleanup: remove listeners, stop heartbeat
      const cleanup = () => {
        if (closed) return; // prevent double cleanup
        closed = true;
        const duration = Math.round((Date.now() - connectedAt) / 1000);
        console.log(`[SSE] Client disconnected (${duration}s, ${eventCount} events forwarded)`);
        clearInterval(heartbeat);
        gw.off("gatewayEvent", onGatewayEvent);
        gw.off("stateChange", onStateChange);
      };

      // Primary cleanup: request.signal fires when client disconnects
      signal.addEventListener("abort", cleanup, { once: true });

      // Store for cancel callback as fallback
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
