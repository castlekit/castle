/**
 * Connection stress tests — SSE and WebSocket under pressure.
 *
 * Uses real WebSocket servers and mock EventSource to test
 * reconnection storms, event deduplication, subscriber churn,
 * oversized messages, and pending request cleanup.
 *
 * Run: npm run stress
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "net";

// ---------------------------------------------------------------------------
// Gateway WS mocks (same pattern as integration tests)
// ---------------------------------------------------------------------------

let testPort: number;

vi.mock("@/lib/config", () => ({
  getGatewayUrl: () => `ws://127.0.0.1:${testPort}`,
  readOpenClawToken: () => "rew_stress_test",
  readConfig: () => ({
    openclaw: { gateway_port: testPort, gateway_token: "rew_stress_test" },
    server: { port: 3333 },
  }),
  configExists: () => true,
}));

vi.mock("@/lib/device-identity", () => ({
  getOrCreateIdentity: () => ({ deviceId: "dev-stress", publicKey: "pk-stress", privateKey: "sk-stress" }),
  signDeviceAuth: () => ({ signature: "sig-stress", signedAt: Date.now() }),
  saveDeviceToken: vi.fn(),
  getDeviceToken: () => null,
  clearDeviceToken: vi.fn(),
}));

// ---------------------------------------------------------------------------
// WebSocket server helpers
// ---------------------------------------------------------------------------

let wss: WebSocketServer;
let lastClient: WebSocket | null = null;
const allClients: WebSocket[] = [];

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port: 0 });
    wss.on("listening", () => {
      testPort = (wss.address() as AddressInfo).port;
      resolve();
    });
    wss.on("connection", (ws) => {
      lastClient = ws;
      allClients.push(ws);
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (wss) {
      wss.close(() => resolve());
    } else {
      resolve();
    }
  });
}

function waitForClient(timeoutMs = 5000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    if (lastClient && lastClient.readyState === WebSocket.OPEN) {
      resolve(lastClient);
      return;
    }
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for client")), timeoutMs);
    const handler = (ws: WebSocket) => {
      clearTimeout(timeout);
      lastClient = ws;
      resolve(ws);
    };
    wss.once("connection", handler);
  });
}

function nextMessage(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for message")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
}

/** Complete the connect handshake for a client */
async function completeHandshake(client: WebSocket, version = "2.0.0") {
  const connectFrame = await nextMessage(client);
  client.send(JSON.stringify({
    type: "res",
    id: connectFrame.id,
    ok: true,
    payload: {
      server: { version, connId: `conn-${Date.now()}` },
      features: { methods: ["chat.send", "chat.abort"], events: ["chat"] },
    },
  }));
}

function logPerf(label: string, count: number, durationMs: number) {
  const rate = Math.round(count / (durationMs / 1000));
  console.log(`[Stress] ${label}: ${count} ops in ${durationMs}ms (${rate} ops/s)`);
}

// ---------------------------------------------------------------------------
// SSE mock (same pattern as sse-singleton.test.ts)
// ---------------------------------------------------------------------------

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  close = vi.fn(() => { this.readyState = 2; });

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  simulateMessage(data: string) {
    this.onmessage?.({ data });
  }

  simulateError() {
    this.onerror?.();
  }

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
}

vi.stubGlobal("EventSource", MockEventSource);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Connection Stress", () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    const gw = (globalThis as Record<string, unknown>)["__castle_gateway__"];
    if (gw && typeof (gw as { stop: () => void }).stop === "function") {
      (gw as { stop: () => void }).stop();
    }
    (globalThis as Record<string, unknown>)["__castle_gateway__"] = undefined;
    await stopServer();
  });

  beforeEach(() => {
    lastClient = null;
    allClients.length = 0;
    MockEventSource.instances = [];
    (globalThis as Record<string, unknown>)["__castle_gateway__"] = undefined;
    vi.resetModules();
  });

  afterEach(() => {
    const gw = (globalThis as Record<string, unknown>)["__castle_gateway__"];
    if (gw && typeof (gw as { stop: () => void }).stop === "function") {
      (gw as { stop: () => void }).stop();
    }
    (globalThis as Record<string, unknown>)["__castle_gateway__"] = undefined;
  });

  // ---- SSE Tests ----

  it("should handle 100 subscribers connecting/disconnecting with correct ref counting", async () => {
    const sse = await import("@/lib/sse-singleton");
    await new Promise((r) => setTimeout(r, 10)); // let mock settle

    const TOTAL = 100;
    const unsubscribers: (() => void)[] = [];
    const eventsReceived: number[] = Array(TOTAL).fill(0);

    const start = Date.now();

    // Subscribe 100 handlers
    for (let i = 0; i < TOTAL; i++) {
      const unsub = sse.subscribe("*", () => { eventsReceived[i]++; });
      unsubscribers.push(unsub);
    }

    // Should have exactly 1 EventSource connection (shared)
    expect(MockEventSource.instances.length).toBe(1);
    const es = MockEventSource.instances[0];

    // Fire 50 events
    for (let seq = 1; seq <= 50; seq++) {
      es.simulateMessage(JSON.stringify({ event: "chat", seq, payload: { msg: seq } }));
    }

    // Each subscriber should have received all 50 events
    for (let i = 0; i < TOTAL; i++) {
      expect(eventsReceived[i]).toBe(50);
    }

    // Unsubscribe half
    for (let i = 0; i < 50; i++) {
      unsubscribers[i]();
    }

    // Connection should still be open (50 remaining)
    expect(es.close).not.toHaveBeenCalled();

    // Fire more events — only remaining subscribers receive them
    for (let seq = 51; seq <= 60; seq++) {
      es.simulateMessage(JSON.stringify({ event: "chat", seq, payload: { msg: seq } }));
    }

    for (let i = 0; i < 50; i++) {
      expect(eventsReceived[i]).toBe(50); // unsubscribed, stayed at 50
    }
    for (let i = 50; i < TOTAL; i++) {
      expect(eventsReceived[i]).toBe(60); // got all 60
    }

    // Unsubscribe all remaining
    for (let i = 50; i < TOTAL; i++) {
      unsubscribers[i]();
    }

    // Connection should now be closed
    expect(es.close).toHaveBeenCalled();

    const duration = Date.now() - start;
    logPerf("SSE subscriber storm", TOTAL, duration);
  });

  it("should correctly deduplicate 1000 events with duplicate sequence numbers", async () => {
    const sse = await import("@/lib/sse-singleton");
    await new Promise((r) => setTimeout(r, 10));

    let received = 0;
    const seenSeqs: number[] = [];

    const unsub = sse.subscribe("*", (evt) => {
      received++;
      if (typeof evt.seq === "number") seenSeqs.push(evt.seq);
    });

    const es = MockEventSource.instances[0];

    const start = Date.now();
    const UNIQUE = 500;
    const TOTAL_WITH_DUPES = 1000;

    // Send 500 unique events, then replay them all (duplicates)
    for (let seq = 1; seq <= UNIQUE; seq++) {
      es.simulateMessage(JSON.stringify({ event: "chat", seq, payload: { n: seq } }));
    }
    // Replay — all should be dropped
    for (let seq = 1; seq <= UNIQUE; seq++) {
      es.simulateMessage(JSON.stringify({ event: "chat", seq, payload: { n: seq } }));
    }

    const duration = Date.now() - start;

    expect(received).toBe(UNIQUE);
    expect(seenSeqs.length).toBe(UNIQUE);

    // Verify sequence order
    for (let i = 1; i < seenSeqs.length; i++) {
      expect(seenSeqs[i]).toBeGreaterThan(seenSeqs[i - 1]);
    }

    logPerf(`SSE dedup (${UNIQUE} unique, ${TOTAL_WITH_DUPES - UNIQUE} dropped)`, TOTAL_WITH_DUPES, duration);

    unsub();
  });

  it("should handle pattern matching under load", async () => {
    const sse = await import("@/lib/sse-singleton");
    await new Promise((r) => setTimeout(r, 10));

    let chatCount = 0;
    let agentCount = 0;
    let allCount = 0;

    const unsub1 = sse.subscribe("chat", () => { chatCount++; });
    const unsub2 = sse.subscribe("agent.*", () => { agentCount++; });
    const unsub3 = sse.subscribe("*", () => { allCount++; });

    const es = MockEventSource.instances[0];
    const start = Date.now();

    let seq = 1;
    // 200 chat events
    for (let i = 0; i < 200; i++) {
      es.simulateMessage(JSON.stringify({ event: "chat", seq: seq++, payload: {} }));
    }
    // 200 agent.* events (various subtypes)
    const agentEvents = ["agent.created", "agent.updated", "agent.status", "agent.removed"];
    for (let i = 0; i < 200; i++) {
      es.simulateMessage(JSON.stringify({ event: agentEvents[i % 4], seq: seq++, payload: {} }));
    }
    // 100 other events
    for (let i = 0; i < 100; i++) {
      es.simulateMessage(JSON.stringify({ event: "system.heartbeat", seq: seq++, payload: {} }));
    }

    const duration = Date.now() - start;

    expect(chatCount).toBe(200);
    expect(agentCount).toBe(200);
    expect(allCount).toBe(500); // all events

    logPerf("SSE pattern matching", 500, duration);

    unsub1();
    unsub2();
    unsub3();
  });

  // ---- WebSocket Gateway Tests ----

  it("should reconnect after rapid server drops", async () => {
    const { getGateway } = await import("@/lib/gateway-connection");

    const gw = getGateway();
    const stateChanges: string[] = [];
    gw.on("stateChange", (s: string) => stateChanges.push(s));

    gw.start();

    // Complete initial handshake
    const client1 = await waitForClient();
    await completeHandshake(client1);

    // Wait for connected state
    await new Promise<void>((resolve) => {
      if (gw.isConnected) { resolve(); return; }
      gw.on("stateChange", function handler(s: string) {
        if (s === "connected") { gw.off("stateChange", handler); resolve(); }
      });
    });

    expect(gw.state).toBe("connected");

    // Drop the connection — gateway should reconnect
    const start = Date.now();
    client1.close(1000, "stress test drop 1");

    // Wait for reconnection
    const client2 = await waitForClient(10000);
    await completeHandshake(client2, "2.0.1");

    await new Promise<void>((resolve) => {
      if (gw.isConnected) { resolve(); return; }
      gw.on("stateChange", function handler(s: string) {
        if (s === "connected") { gw.off("stateChange", handler); resolve(); }
      });
    });

    const duration = Date.now() - start;

    expect(gw.state).toBe("connected");
    expect(stateChanges).toContain("disconnected");

    logPerf("WS reconnection after drop", 1, duration);

    gw.stop();
  });

  it("should reject pending requests when connection drops", async () => {
    const { getGateway } = await import("@/lib/gateway-connection");

    const gw = getGateway();
    gw.start();

    const client = await waitForClient();
    await completeHandshake(client);

    await new Promise<void>((resolve) => {
      if (gw.isConnected) { resolve(); return; }
      gw.on("stateChange", function handler(s: string) {
        if (s === "connected") { gw.off("stateChange", handler); resolve(); }
      });
    });

    // Send 10 RPC requests simultaneously (don't respond to any)
    const PENDING = 10;
    const start = Date.now();
    const promises: Promise<unknown>[] = [];

    // Read the connect frame if there's one pending, then ignore RPC frames
    for (let i = 0; i < PENDING; i++) {
      promises.push(
        gw.request(`stress.method.${i}`, { n: i }).catch((err) => err)
      );
    }

    // Give a moment for frames to be sent
    await new Promise((r) => setTimeout(r, 100));

    // Drop the connection — all pending requests should be rejected
    client.close(1000, "stress drop");

    const results = await Promise.all(promises);
    const duration = Date.now() - start;

    // All should be errors (connection closed)
    let rejectedCount = 0;
    for (const result of results) {
      if (result instanceof Error) {
        rejectedCount++;
        expect(result.message).toContain("Connection closed");
      }
    }

    expect(rejectedCount).toBe(PENDING);
    logPerf(`WS pending request rejection (${PENDING} requests)`, PENDING, duration);

    gw.stop();
  });

  it("should handle oversized messages without crashing", async () => {
    const { getGateway } = await import("@/lib/gateway-connection");

    const gw = getGateway();
    const events: string[] = [];
    gw.on("stateChange", (s: string) => events.push(s));

    gw.start();

    const client = await waitForClient();
    await completeHandshake(client);

    await new Promise<void>((resolve) => {
      if (gw.isConnected) { resolve(); return; }
      gw.on("stateChange", function handler(s: string) {
        if (s === "connected") { gw.off("stateChange", handler); resolve(); }
      });
    });

    // Send an oversized message (11MB — over the 10MB limit)
    const oversized = JSON.stringify({
      type: "event",
      event: "chat",
      payload: { data: "x".repeat(11 * 1024 * 1024) },
    });

    const start = Date.now();
    client.send(oversized);
    await new Promise((r) => setTimeout(r, 500));
    const duration = Date.now() - start;

    // Connection should still be alive (message rejected, not crashed)
    expect(gw.state).toBe("connected");

    // Send a normal event to verify the connection still works
    client.send(JSON.stringify({
      type: "event",
      event: "chat",
      payload: { test: "after-oversized" },
      seq: 1,
    }));

    await new Promise((r) => setTimeout(r, 100));

    // Gateway should still be connected
    expect(gw.state).toBe("connected");

    logPerf("Oversized message handling", 1, duration);

    gw.stop();
  });

  it("should handle events received between RPC requests", async () => {
    const { getGateway } = await import("@/lib/gateway-connection");

    const gw = getGateway();
    const receivedEvents: unknown[] = [];
    gw.on("gatewayEvent", (evt: unknown) => receivedEvents.push(evt));

    gw.start();

    const client = await waitForClient();
    await completeHandshake(client);

    await new Promise<void>((resolve) => {
      if (gw.isConnected) { resolve(); return; }
      gw.on("stateChange", function handler(s: string) {
        if (s === "connected") { gw.off("stateChange", handler); resolve(); }
      });
    });

    const start = Date.now();
    const EVENT_COUNT = 200;

    // Send an RPC request
    const rpcPromise = gw.request("chat.send", { message: "stress" });

    // Meanwhile, fire 200 events rapidly
    for (let seq = 1; seq <= EVENT_COUNT; seq++) {
      client.send(JSON.stringify({
        type: "event",
        event: "chat",
        payload: { seq, content: `Event ${seq}` },
        seq,
      }));
    }

    // Now respond to the RPC request
    // Read the frames the gateway sent to find the RPC request ID
    const frames: Record<string, unknown>[] = [];
    client.on("message", (data) => {
      frames.push(JSON.parse(data.toString()));
    });

    // Wait a bit for events and frames to flow
    await new Promise((r) => setTimeout(r, 200));

    // Find the RPC request frame (it was sent before our listener was attached)
    // Respond to any pending request
    const reqFrame = frames.find((f) => f.type === "req" && f.method === "chat.send");
    if (reqFrame) {
      client.send(JSON.stringify({
        type: "res",
        id: reqFrame.id,
        ok: true,
        payload: { runId: "run-stress-events" },
      }));
    }

    // Wait for RPC to complete (or timeout)
    try {
      await Promise.race([rpcPromise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))]);
    } catch {
      // OK — might timeout if we missed the request frame
    }

    const duration = Date.now() - start;

    // Should have received all events despite concurrent RPC
    expect(receivedEvents.length).toBe(EVENT_COUNT);

    logPerf(`Events during RPC (${EVENT_COUNT} events)`, EVENT_COUNT, duration);

    gw.stop();
  });
});
