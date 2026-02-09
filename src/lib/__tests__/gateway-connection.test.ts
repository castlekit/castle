import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket extends EventEmitter {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;

  constructor(url: string) {
    super();
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string, callback?: (err?: Error) => void) {
    if (callback) callback();
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", 1000, Buffer.from("normal"));
  }

  // Test helper: simulate the WS opening
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  // Test helper: simulate a received message
  simulateMessage(data: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(data)));
  }

  // Test helper: simulate error
  simulateError(msg: string) {
    this.emit("error", new Error(msg));
  }
}

// Mock the ws module
vi.mock("ws", () => {
  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

// Mock config module — provide a token so connect() proceeds
vi.mock("@/lib/config", () => ({
  getGatewayUrl: () => "ws://127.0.0.1:18789",
  readOpenClawToken: () => "test-token-123",
  readConfig: () => ({
    openclaw: { gateway_port: 18789, gateway_token: "test-token-123" },
    server: { port: 3333 },
  }),
  configExists: () => true,
}));

// Mock device-identity
vi.mock("@/lib/device-identity", () => ({
  getOrCreateIdentity: () => ({ deviceId: "dev-1", publicKey: "pk-1", privateKey: "sk-1" }),
  signDeviceAuth: () => ({ signature: "sig", signedAt: Date.now() }),
  saveDeviceToken: vi.fn(),
  getDeviceToken: () => null,
  clearDeviceToken: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GatewayConnection", () => {
  beforeEach(() => {
    vi.resetModules();
    MockWebSocket.instances = [];
    // Clear globalThis gateway singleton
    (globalThis as Record<string, unknown>)["__castle_gateway__"] = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Stop any gateway to prevent reconnect timers
    const gw = (globalThis as Record<string, unknown>)["__castle_gateway__"];
    if (gw && typeof (gw as { stop: () => void }).stop === "function") {
      (gw as { stop: () => void }).stop();
    }
    (globalThis as Record<string, unknown>)["__castle_gateway__"] = undefined;
  });

  it("getGateway should return the same instance (singleton)", async () => {
    const { getGateway } = await import("../gateway-connection");

    const gw1 = getGateway();
    const gw2 = getGateway();
    expect(gw1).toBe(gw2);
  });

  it("should start in disconnected state", async () => {
    const { getGateway } = await import("../gateway-connection");

    const gw = getGateway();
    expect(gw.state).toBe("disconnected");
    expect(gw.isConnected).toBe(false);
  });

  it("start should create a WebSocket connection", async () => {
    const { getGateway } = await import("../gateway-connection");

    const gw = getGateway();
    gw.start();

    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toBe("ws://127.0.0.1:18789");
    expect(gw.state).toBe("connecting");

    gw.stop();
  });

  it("should transition to connected on successful handshake", async () => {
    const { getGateway } = await import("../gateway-connection");

    const gw = getGateway();
    const stateChanges: string[] = [];
    gw.on("stateChange", (s: string) => stateChanges.push(s));

    gw.start();
    const ws = MockWebSocket.instances[0];

    // Capture the connect frame to know its ID
    let connectId = "";
    const originalSend = ws.send.bind(ws);
    ws.send = (data: string, cb?: (err?: Error) => void) => {
      try {
        const frame = JSON.parse(data);
        if (frame.method === "connect") connectId = frame.id;
      } catch { /* ignore */ }
      originalSend(data, cb);
    };

    // Simulate WS open — triggers the connect frame send
    ws.simulateOpen();

    // Simulate successful connect response
    ws.simulateMessage({
      type: "res",
      id: connectId,
      ok: true,
      payload: {
        server: { version: "2.0.0", connId: "conn-1" },
        features: { methods: ["chat.send"], events: ["chat"] },
      },
    });

    expect(gw.state).toBe("connected");
    expect(gw.isConnected).toBe(true);
    expect(gw.serverInfo.version).toBe("2.0.0");
    expect(stateChanges).toContain("connecting");
    expect(stateChanges).toContain("connected");

    gw.stop();
  });

  it("should handle request/response RPC cycle", async () => {
    const { getGateway } = await import("../gateway-connection");

    const gw = getGateway();
    gw.start();
    const ws = MockWebSocket.instances[0];

    // Capture connect ID
    let connectId = "";
    const origSend = ws.send.bind(ws);
    const sentFrames: unknown[] = [];
    ws.send = (data: string, cb?: (err?: Error) => void) => {
      try {
        const frame = JSON.parse(data);
        sentFrames.push(frame);
        if (frame.method === "connect") connectId = frame.id;
      } catch { /* ignore */ }
      if (cb) cb();
    };

    ws.simulateOpen();
    ws.simulateMessage({ type: "res", id: connectId, ok: true, payload: { server: {} } });

    expect(gw.isConnected).toBe(true);

    // Make an RPC request
    const requestPromise = gw.request("chat.send", { message: "Hello" });

    // Find the sent RPC frame
    const rpcFrame = sentFrames.find(
      (f: unknown) => (f as { method: string }).method === "chat.send"
    ) as { id: string; method: string; params: unknown } | undefined;
    expect(rpcFrame).toBeDefined();
    expect(rpcFrame!.params).toEqual({ message: "Hello" });

    // Simulate response
    ws.simulateMessage({
      type: "res",
      id: rpcFrame!.id,
      ok: true,
      payload: { runId: "run-1" },
    });

    const result = await requestPromise;
    expect(result).toEqual({ runId: "run-1" });

    gw.stop();
  });

  it("should reject requests with error response", async () => {
    const { getGateway } = await import("../gateway-connection");

    const gw = getGateway();
    gw.start();
    const ws = MockWebSocket.instances[0];

    let connectId = "";
    const sentFrames: unknown[] = [];
    ws.send = (data: string, cb?: (err?: Error) => void) => {
      try {
        const frame = JSON.parse(data);
        sentFrames.push(frame);
        if (frame.method === "connect") connectId = frame.id;
      } catch { /* ignore */ }
      if (cb) cb();
    };

    ws.simulateOpen();
    ws.simulateMessage({ type: "res", id: connectId, ok: true, payload: { server: {} } });

    const requestPromise = gw.request("bad.method", {});

    const rpcFrame = sentFrames.find(
      (f: unknown) => (f as { method: string }).method === "bad.method"
    ) as { id: string } | undefined;

    ws.simulateMessage({
      type: "res",
      id: rpcFrame!.id,
      ok: false,
      error: { code: "not_found", message: "Method not found" },
    });

    await expect(requestPromise).rejects.toThrow("Method not found");

    gw.stop();
  });

  it("should throw when requesting on disconnected gateway", async () => {
    const { getGateway } = await import("../gateway-connection");

    const gw = getGateway();
    // Don't start — stays disconnected
    await expect(gw.request("test", {})).rejects.toThrow("Gateway not connected");
  });

  it("should emit gateway events", async () => {
    const { getGateway } = await import("../gateway-connection");

    const gw = getGateway();
    gw.start();
    const ws = MockWebSocket.instances[0];

    let connectId = "";
    ws.send = (data: string, cb?: (err?: Error) => void) => {
      try {
        const frame = JSON.parse(data);
        if (frame.method === "connect") connectId = frame.id;
      } catch { /* ignore */ }
      if (cb) cb();
    };

    ws.simulateOpen();
    ws.simulateMessage({ type: "res", id: connectId, ok: true, payload: { server: {} } });

    const events: unknown[] = [];
    gw.on("gatewayEvent", (evt: unknown) => events.push(evt));

    // Simulate a gateway event
    ws.simulateMessage({
      type: "event",
      event: "chat",
      payload: { runId: "run-evt", state: "delta" },
      seq: 1,
    });

    expect(events.length).toBe(1);
    expect((events[0] as { event: string }).event).toBe("chat");

    gw.stop();
  });

  it("stop should clean up and reject pending requests", async () => {
    const { getGateway } = await import("../gateway-connection");

    const gw = getGateway();
    gw.start();
    const ws = MockWebSocket.instances[0];

    let connectId = "";
    ws.send = (data: string, cb?: (err?: Error) => void) => {
      try {
        const frame = JSON.parse(data);
        if (frame.method === "connect") connectId = frame.id;
      } catch { /* ignore */ }
      if (cb) cb();
    };

    ws.simulateOpen();
    ws.simulateMessage({ type: "res", id: connectId, ok: true, payload: { server: {} } });

    // Start a request but don't resolve it
    const pending = gw.request("slow.method", {});

    // Stop the gateway
    gw.stop();

    await expect(pending).rejects.toThrow("Connection closed");
    expect(gw.state).toBe("disconnected");
  });

  it("should store and retrieve avatar URLs", async () => {
    const { getGateway } = await import("../gateway-connection");

    const gw = getGateway();
    gw.setAvatarUrl("abc123", "http://gateway:18789/api/v1/avatars/abc123");
    expect(gw.getAvatarUrl("abc123")).toBe("http://gateway:18789/api/v1/avatars/abc123");
    expect(gw.getAvatarUrl("nonexistent")).toBeNull();
  });

  it("ensureGateway should auto-start if disconnected", async () => {
    const { ensureGateway } = await import("../gateway-connection");

    const gw = ensureGateway();
    expect(gw.state).toBe("connecting");
    expect(MockWebSocket.instances.length).toBe(1);

    gw.stop();
  });

  it("should ignore oversized messages", async () => {
    const { getGateway } = await import("../gateway-connection");

    const gw = getGateway();
    gw.start();
    const ws = MockWebSocket.instances[0];

    let connectId = "";
    ws.send = (data: string, cb?: (err?: Error) => void) => {
      try {
        const frame = JSON.parse(data);
        if (frame.method === "connect") connectId = frame.id;
      } catch { /* ignore */ }
      if (cb) cb();
    };

    ws.simulateOpen();
    ws.simulateMessage({ type: "res", id: connectId, ok: true, payload: { server: {} } });

    const events: unknown[] = [];
    gw.on("gatewayEvent", (evt: unknown) => events.push(evt));

    // Send an oversized message (>10MB)
    const bigPayload = "x".repeat(11 * 1024 * 1024);
    ws.emit("message", Buffer.from(bigPayload));

    // Should have been ignored
    expect(events.length).toBe(0);

    gw.stop();
  });
});
