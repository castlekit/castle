import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installTestDb } from "@/lib/db/__tests__/test-db";

// Mock the gateway to prevent real WebSocket connections
vi.mock("@/lib/gateway-connection", () => {
  const mockGateway = {
    state: "connected",
    isConnected: true,
    isConfigured: true,
    serverInfo: { version: "test" },
    start: vi.fn(),
    stop: vi.fn(),
    request: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  };
  return {
    getGateway: () => mockGateway,
    ensureGateway: () => mockGateway,
    __mockGateway: mockGateway,
  };
});

// ============================================================================
// Helpers
// ============================================================================

function makeReq(
  url: string,
  opts?: { method?: string; body?: unknown; headers?: Record<string, string> }
): NextRequest {
  const { method = "GET", body, headers = {} } = opts ?? {};
  const h: Record<string, string> = {
    host: "localhost:3333",
    origin: "http://localhost:3333",
    ...headers,
  };
  if (body) {
    h["content-type"] = "application/json";
  }
  return new NextRequest(new URL(url, "http://localhost:3333"), {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  } as never);
}

async function json(res: Response) {
  return res.json();
}

// ============================================================================
// Tests
// ============================================================================

describe("Chat API", () => {
  let cleanup: () => void;
  let mockGw: { request: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    const setup = installTestDb();
    cleanup = setup.cleanup;

    const gwMod = await import("@/lib/gateway-connection");
    mockGw = (gwMod as unknown as { __mockGateway: typeof mockGw }).__mockGateway;
  });

  afterAll(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- POST (Send) ----

  describe("POST (send)", () => {
    it("should send a message and return runId", async () => {
      const { POST } = await import("../route");
      const { createChannel } = await import("@/lib/db/queries");
      const channel = createChannel("Chat Send Test", "main");

      mockGw.request.mockResolvedValue({ runId: "run-test-123", status: "ok" });

      const req = makeReq("http://localhost:3333/api/openclaw/chat", {
        method: "POST",
        body: { channelId: channel.id, content: "Hello agent!", agentId: "main" },
      });

      const res = await POST(req);
      const data = await json(res);

      expect(res.status).toBe(200);
      expect(data.runId).toBe("run-test-123");
      expect(data.messageId).toBeTruthy();
      expect(data.sessionKey).toBeTruthy();

      expect(mockGw.request).toHaveBeenCalledWith(
        "chat.send",
        expect.objectContaining({ message: "Hello agent!" })
      );
    });

    it("should reject missing channelId", async () => {
      const { POST } = await import("../route");
      const req = makeReq("http://localhost:3333/api/openclaw/chat", {
        method: "POST",
        body: { content: "Hello" },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("should reject missing content", async () => {
      const { POST } = await import("../route");
      const req = makeReq("http://localhost:3333/api/openclaw/chat", {
        method: "POST",
        body: { channelId: "ch1" },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("should reject overly long messages", async () => {
      const { POST } = await import("../route");
      const req = makeReq("http://localhost:3333/api/openclaw/chat", {
        method: "POST",
        body: { channelId: "ch1", content: "x".repeat(32769) },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("should return 502 if gateway fails", async () => {
      const { POST } = await import("../route");
      const { createChannel } = await import("@/lib/db/queries");
      const channel = createChannel("GW Fail", "main");

      mockGw.request.mockRejectedValue(new Error("Gateway not connected"));

      const req = makeReq("http://localhost:3333/api/openclaw/chat", {
        method: "POST",
        body: { channelId: channel.id, content: "This will fail" },
      });
      const res = await POST(req);
      expect(res.status).toBe(502);
    });
  });

  // ---- PUT (Complete) ----

  describe("PUT (complete)", () => {
    it("should create a new agent message", async () => {
      const { PUT } = await import("../route");
      const { createChannel } = await import("@/lib/db/queries");
      const channel = createChannel("Put Test", "main");

      const req = makeReq("http://localhost:3333/api/openclaw/chat", {
        method: "PUT",
        body: {
          runId: "run-put-123",
          channelId: channel.id,
          content: "Agent response",
          agentId: "main",
          agentName: "Sam",
          status: "complete",
          sessionKey: "sk-test",
        },
      });

      const res = await PUT(req);
      const data = await json(res);

      expect(res.status).toBe(200);
      expect(data.messageId).toBeTruthy();
      expect(data.updated).toBe(false);
    });

    it("should update an existing message by runId", async () => {
      const { PUT } = await import("../route");
      const { createChannel, createMessage } = await import("@/lib/db/queries");

      const channel = createChannel("Put Update", "main");
      createMessage({
        channelId: channel.id,
        senderType: "agent",
        senderId: "main",
        content: "Partial...",
        runId: "run-update-456",
      });

      const req = makeReq("http://localhost:3333/api/openclaw/chat", {
        method: "PUT",
        body: {
          runId: "run-update-456",
          channelId: channel.id,
          content: "Complete response",
          agentId: "main",
          status: "complete",
        },
      });

      const res = await PUT(req);
      const data = await json(res);
      expect(data.updated).toBe(true);
    });

    it("should reject missing required fields", async () => {
      const { PUT } = await import("../route");
      const req = makeReq("http://localhost:3333/api/openclaw/chat", {
        method: "PUT",
        body: { runId: "run-123" },
      });
      const res = await PUT(req);
      expect(res.status).toBe(400);
    });
  });

  // ---- GET (History) ----

  describe("GET (history)", () => {
    it("should return messages for a channel", async () => {
      const { GET } = await import("../route");
      const { createChannel, createMessage } = await import("@/lib/db/queries");

      const channel = createChannel("History Test", "main");
      createMessage({ channelId: channel.id, senderType: "user", senderId: "u1", content: "Msg 1" });
      createMessage({ channelId: channel.id, senderType: "agent", senderId: "main", content: "Reply 1" });

      const req = makeReq(`http://localhost:3333/api/openclaw/chat?channelId=${channel.id}`);
      const res = await GET(req);
      const data = await json(res);

      expect(res.status).toBe(200);
      expect(data.messages.length).toBe(2);
    });

    it("should reject missing channelId", async () => {
      const { GET } = await import("../route");
      const req = makeReq("http://localhost:3333/api/openclaw/chat");
      const res = await GET(req);
      expect(res.status).toBe(400);
    });
  });

  // ---- DELETE (Abort) ----

  describe("DELETE (abort)", () => {
    it("should call chat.abort on gateway", async () => {
      const { DELETE } = await import("../route");
      mockGw.request.mockResolvedValue({});

      const req = makeReq("http://localhost:3333/api/openclaw/chat", { method: "DELETE" });
      const res = await DELETE(req);
      const data = await json(res);

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockGw.request).toHaveBeenCalledWith("chat.abort", {});
    });

    it("should return 502 if abort fails", async () => {
      const { DELETE } = await import("../route");
      mockGw.request.mockRejectedValue(new Error("Gateway not connected"));

      const req = makeReq("http://localhost:3333/api/openclaw/chat", { method: "DELETE" });
      const res = await DELETE(req);
      expect(res.status).toBe(502);
    });
  });
});
