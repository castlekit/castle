/**
 * Integration test: Gateway WebSocket protocol
 *
 * Spins up a real WebSocket server, connects the actual GatewayConnection
 * class to it, and verifies the full handshake, RPC, and event cycle
 * over real network I/O.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "net";

// Mock config to point at our test WS server
let testPort: number;

vi.mock("@/lib/config", () => ({
  getGatewayUrl: () => `ws://127.0.0.1:${testPort}`,
  readOpenClawToken: () => "rew_test_integration",
  readConfig: () => ({
    openclaw: { gateway_port: testPort, gateway_token: "rew_test_integration" },
    server: { port: 3333 },
  }),
  configExists: () => true,
}));

vi.mock("@/lib/device-identity", () => ({
  getOrCreateIdentity: () => ({ deviceId: "dev-int", publicKey: "pk-int", privateKey: "sk-int" }),
  signDeviceAuth: () => ({ signature: "sig-int", signedAt: Date.now() }),
  saveDeviceToken: vi.fn(),
  getDeviceToken: () => null,
  clearDeviceToken: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test WS Server
// ---------------------------------------------------------------------------

let wss: WebSocketServer;
let lastClient: WebSocket | null = null;

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port: 0 }); // random available port
    wss.on("listening", () => {
      testPort = (wss.address() as AddressInfo).port;
      resolve();
    });
    wss.on("connection", (ws) => {
      lastClient = ws;
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

/** Wait for client to connect to our test server */
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

/** Read next message from a client */
function nextMessage(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for message")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration: Gateway WebSocket Protocol", () => {
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
    (globalThis as Record<string, unknown>)["__castle_gateway__"] = undefined;
  });

  afterEach(() => {
    const gw = (globalThis as Record<string, unknown>)["__castle_gateway__"];
    if (gw && typeof (gw as { stop: () => void }).stop === "function") {
      (gw as { stop: () => void }).stop();
    }
    (globalThis as Record<string, unknown>)["__castle_gateway__"] = undefined;
  });

  it("should perform full connect handshake over real WebSocket", async () => {
    const { getGateway } = await import("@/lib/gateway-connection");

    const gw = getGateway();
    const stateChanges: string[] = [];
    gw.on("stateChange", (s: string) => stateChanges.push(s));

    gw.start();

    // Wait for client to connect to our test server
    const client = await waitForClient();

    // Read the connect frame from the client
    const connectFrame = await nextMessage(client);
    expect(connectFrame.type).toBe("req");
    expect(connectFrame.method).toBe("connect");
    expect((connectFrame.params as Record<string, unknown>).minProtocol).toBe(3);

    // Respond with success
    client.send(
      JSON.stringify({
        type: "res",
        id: connectFrame.id,
        ok: true,
        payload: {
          server: { version: "2.1.0", connId: "int-conn-1" },
          features: { methods: ["chat.send", "chat.abort"], events: ["chat"] },
        },
      }),
    );

    // Wait for connected state
    await new Promise<void>((resolve) => {
      if (gw.isConnected) { resolve(); return; }
      gw.on("stateChange", function handler(s: string) {
        if (s === "connected") { gw.off("stateChange", handler); resolve(); }
      });
    });

    expect(gw.isConnected).toBe(true);
    expect(gw.serverInfo.version).toBe("2.1.0");
    expect(stateChanges).toContain("connecting");
    expect(stateChanges).toContain("connected");

    gw.stop();
  });

  it("should send RPC request and receive response over real WebSocket", async () => {
    const { getGateway } = await import("@/lib/gateway-connection");

    const gw = getGateway();
    gw.start();

    const client = await waitForClient();

    // Complete handshake
    const connectFrame = await nextMessage(client);
    client.send(
      JSON.stringify({
        type: "res",
        id: connectFrame.id,
        ok: true,
        payload: { server: { version: "2.1.0" } },
      }),
    );

    await new Promise<void>((resolve) => {
      if (gw.isConnected) { resolve(); return; }
      gw.on("stateChange", function handler(s: string) {
        if (s === "connected") { gw.off("stateChange", handler); resolve(); }
      });
    });

    // Now make an RPC request
    const rpcPromise = gw.request<{ runId: string }>("chat.send", {
      message: "Hello from integration test",
      sessionKey: "sk-int-001",
    });

    // Read the RPC frame on the server side
    const rpcFrame = await nextMessage(client);
    expect(rpcFrame.type).toBe("req");
    expect(rpcFrame.method).toBe("chat.send");
    expect((rpcFrame.params as Record<string, unknown>).message).toBe(
      "Hello from integration test",
    );

    // Respond
    client.send(
      JSON.stringify({
        type: "res",
        id: rpcFrame.id,
        ok: true,
        payload: { runId: "run-int-001" },
      }),
    );

    const result = await rpcPromise;
    expect(result.runId).toBe("run-int-001");

    gw.stop();
  });

  it("should receive and emit gateway events over real WebSocket", async () => {
    const { getGateway } = await import("@/lib/gateway-connection");

    const gw = getGateway();
    gw.start();

    const client = await waitForClient();

    // Complete handshake
    const connectFrame = await nextMessage(client);
    client.send(
      JSON.stringify({
        type: "res",
        id: connectFrame.id,
        ok: true,
        payload: { server: {} },
      }),
    );

    await new Promise<void>((resolve) => {
      if (gw.isConnected) { resolve(); return; }
      gw.on("stateChange", function handler(s: string) {
        if (s === "connected") { gw.off("stateChange", handler); resolve(); }
      });
    });

    // Collect events
    const events: Array<{ event: string; payload: unknown }> = [];
    gw.on("gatewayEvent", (evt: { event: string; payload: unknown }) => events.push(evt));

    // Server pushes events
    client.send(
      JSON.stringify({
        type: "event",
        event: "chat",
        payload: { runId: "run-evt-1", state: "delta", text: "Hello" },
        seq: 1,
      }),
    );

    client.send(
      JSON.stringify({
        type: "event",
        event: "chat",
        payload: { runId: "run-evt-1", state: "final", text: "Hello World" },
        seq: 2,
      }),
    );

    // Give events time to arrive
    await new Promise((r) => setTimeout(r, 100));

    expect(events.length).toBe(2);
    expect(events[0].event).toBe("chat");
    expect((events[0].payload as Record<string, unknown>).state).toBe("delta");
    expect(events[1].event).toBe("chat");
    expect((events[1].payload as Record<string, unknown>).state).toBe("final");

    gw.stop();
  });

  it("should handle RPC error responses over real WebSocket", async () => {
    const { getGateway } = await import("@/lib/gateway-connection");

    const gw = getGateway();
    gw.start();

    const client = await waitForClient();

    const connectFrame = await nextMessage(client);
    client.send(
      JSON.stringify({
        type: "res",
        id: connectFrame.id,
        ok: true,
        payload: { server: {} },
      }),
    );

    await new Promise<void>((resolve) => {
      if (gw.isConnected) { resolve(); return; }
      gw.on("stateChange", function handler(s: string) {
        if (s === "connected") { gw.off("stateChange", handler); resolve(); }
      });
    });

    // Make request that will fail
    const rpcPromise = gw.request("bad.method", {});

    const rpcFrame = await nextMessage(client);
    client.send(
      JSON.stringify({
        type: "res",
        id: rpcFrame.id,
        ok: false,
        error: { code: "method_not_found", message: "Unknown method: bad.method" },
      }),
    );

    await expect(rpcPromise).rejects.toThrow("Unknown method: bad.method");

    gw.stop();
  });

  it("should reconnect after server close", async () => {
    const { getGateway } = await import("@/lib/gateway-connection");

    const gw = getGateway();
    gw.start();

    const client1 = await waitForClient();

    // Complete first handshake
    const connectFrame1 = await nextMessage(client1);
    client1.send(
      JSON.stringify({
        type: "res",
        id: connectFrame1.id,
        ok: true,
        payload: { server: { version: "2.0.0" } },
      }),
    );

    await new Promise<void>((resolve) => {
      if (gw.isConnected) { resolve(); return; }
      gw.on("stateChange", function handler(s: string) {
        if (s === "connected") { gw.off("stateChange", handler); resolve(); }
      });
    });

    expect(gw.isConnected).toBe(true);

    // Server closes the connection
    client1.close(1000, "server restart");

    // Wait for reconnect -- gateway uses exponential backoff starting at 1s
    const client2 = await waitForClient(10000);

    // Complete second handshake
    const connectFrame2 = await nextMessage(client2);
    expect(connectFrame2.method).toBe("connect");

    client2.send(
      JSON.stringify({
        type: "res",
        id: connectFrame2.id,
        ok: true,
        payload: { server: { version: "2.0.1" } },
      }),
    );

    await new Promise<void>((resolve) => {
      if (gw.isConnected) { resolve(); return; }
      gw.on("stateChange", function handler(s: string) {
        if (s === "connected") { gw.off("stateChange", handler); resolve(); }
      });
    });

    expect(gw.isConnected).toBe(true);
    expect(gw.serverInfo.version).toBe("2.0.1");

    gw.stop();
  });
});
