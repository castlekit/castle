/**
 * Integration test: Failure recovery
 *
 * Tests that the system handles failures correctly:
 * - Gateway failure during send → optimistic message cleanup
 * - Retry after failure succeeds
 * - Duplicate message handling (idempotency)
 * - Session key persistence across messages
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installTestDb } from "@/lib/db/__tests__/test-db";

const mockGw = {
  state: "connected" as string,
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

vi.mock("@/lib/gateway-connection", () => ({
  getGateway: () => mockGw,
  ensureGateway: () => mockGw,
}));

function req(
  url: string,
  opts?: { method?: string; body?: unknown },
): NextRequest {
  const { method = "GET", body } = opts ?? {};
  const h: Record<string, string> = {
    host: "localhost:3333",
    origin: "http://localhost:3333",
  };
  if (body) h["content-type"] = "application/json";
  return new NextRequest(new URL(url, "http://localhost:3333"), {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  } as never);
}

describe("Integration: Failure Recovery", () => {
  let cleanup: () => void;

  beforeAll(() => {
    const setup = installTestDb();
    cleanup = setup.cleanup;
  });

  afterAll(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    mockGw.isConnected = true;
  });

  it("should clean up optimistic message when gateway fails", async () => {
    const { POST, GET } = await import("@/app/api/openclaw/chat/route");
    const { createChannel } = await import("@/lib/db/queries");

    const channel = createChannel("Failure Recovery", "main");

    // Gateway will reject the send
    mockGw.request.mockRejectedValue(new Error("Gateway timeout"));

    const res = await POST(
      req("http://localhost:3333/api/openclaw/chat", {
        method: "POST",
        body: { channelId: channel.id, content: "This will fail", agentId: "main" },
      }),
    );

    expect(res.status).toBe(502);

    // The optimistic user message should have been cleaned up
    const historyRes = await GET(
      req(`http://localhost:3333/api/openclaw/chat?channelId=${channel.id}`),
    );
    const history = await historyRes.json();

    expect(history.messages.length).toBe(0);
  });

  it("should succeed on retry after failure", async () => {
    const { POST, GET } = await import("@/app/api/openclaw/chat/route");
    const { createChannel } = await import("@/lib/db/queries");

    const channel = createChannel("Retry Success", "main");

    // First attempt: gateway fails
    mockGw.request.mockRejectedValueOnce(new Error("Gateway timeout"));

    const failRes = await POST(
      req("http://localhost:3333/api/openclaw/chat", {
        method: "POST",
        body: { channelId: channel.id, content: "Retry me", agentId: "main" },
      }),
    );
    expect(failRes.status).toBe(502);

    // Second attempt: gateway succeeds
    mockGw.request.mockResolvedValueOnce({ runId: "run-retry-001" });

    const successRes = await POST(
      req("http://localhost:3333/api/openclaw/chat", {
        method: "POST",
        body: { channelId: channel.id, content: "Retry me", agentId: "main" },
      }),
    );
    const data = await successRes.json();
    expect(successRes.status).toBe(200);
    expect(data.runId).toBe("run-retry-001");

    // History should have exactly 1 message (from the successful send)
    const historyRes = await GET(
      req(`http://localhost:3333/api/openclaw/chat?channelId=${channel.id}`),
    );
    const history = await historyRes.json();
    expect(history.messages.length).toBe(1);
    expect(history.messages[0].content).toBe("Retry me");
  });

  it("should reuse session key across multiple messages in same channel", async () => {
    const { POST } = await import("@/app/api/openclaw/chat/route");
    const { createChannel } = await import("@/lib/db/queries");

    const channel = createChannel("Session Reuse", "main");

    // First message
    mockGw.request.mockResolvedValueOnce({ runId: "run-s1" });
    const res1 = await POST(
      req("http://localhost:3333/api/openclaw/chat", {
        method: "POST",
        body: { channelId: channel.id, content: "First", agentId: "main" },
      }),
    );
    const data1 = await res1.json();

    // Second message
    mockGw.request.mockResolvedValueOnce({ runId: "run-s2" });
    const res2 = await POST(
      req("http://localhost:3333/api/openclaw/chat", {
        method: "POST",
        body: { channelId: channel.id, content: "Second", agentId: "main" },
      }),
    );
    const data2 = await res2.json();

    // Same session key should be reused
    expect(data1.sessionKey).toBe(data2.sessionKey);
    expect(data1.sessionKey).toBeTruthy();
  });

  it("should handle PUT idempotency — same content + complete skips update", async () => {
    const { PUT } = await import("@/app/api/openclaw/chat/route");
    const { createChannel, createMessage } = await import("@/lib/db/queries");

    const channel = createChannel("Idempotent", "main");
    const agentMsg = createMessage({
      channelId: channel.id,
      senderType: "agent",
      senderId: "main",
      content: "Final answer",
      runId: "run-idempotent",
      status: "complete",
    });

    // PUT with identical content — should be a no-op
    const res = await PUT(
      req("http://localhost:3333/api/openclaw/chat", {
        method: "PUT",
        body: {
          runId: "run-idempotent",
          channelId: channel.id,
          content: "Final answer",
          agentId: "main",
          status: "complete",
        },
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.messageId).toBe(agentMsg.id);
    expect(data.updated).toBe(false); // idempotent
  });

  it("should handle PUT update — changed content updates the message", async () => {
    const { PUT, GET } = await import("@/app/api/openclaw/chat/route");
    const { createChannel, createMessage } = await import("@/lib/db/queries");

    const channel = createChannel("Update Content", "main");
    createMessage({
      channelId: channel.id,
      senderType: "agent",
      senderId: "main",
      content: "Partial response...",
      runId: "run-update-content",
      status: undefined, // still in progress
    });

    // PUT with new content
    const res = await PUT(
      req("http://localhost:3333/api/openclaw/chat", {
        method: "PUT",
        body: {
          runId: "run-update-content",
          channelId: channel.id,
          content: "Complete and final response!",
          agentId: "main",
          status: "complete",
        },
      }),
    );
    const data = await res.json();

    expect(data.updated).toBe(true);

    // Verify updated content in history
    const historyRes = await GET(
      req(`http://localhost:3333/api/openclaw/chat?channelId=${channel.id}`),
    );
    const history = await historyRes.json();

    const msg = history.messages.find(
      (m: { runId: string }) => m.runId === "run-update-content",
    );
    expect(msg.content).toBe("Complete and final response!");
    expect(msg.status).toBe("complete");
  });

  it("should handle concurrent sends to different channels", async () => {
    const { POST } = await import("@/app/api/openclaw/chat/route");
    const { createChannel } = await import("@/lib/db/queries");

    const ch1 = createChannel("Concurrent A", "main");
    const ch2 = createChannel("Concurrent B", "main");

    mockGw.request
      .mockResolvedValueOnce({ runId: "run-c1" })
      .mockResolvedValueOnce({ runId: "run-c2" });

    // Send to both channels in parallel
    const [res1, res2] = await Promise.all([
      POST(
        req("http://localhost:3333/api/openclaw/chat", {
          method: "POST",
          body: { channelId: ch1.id, content: "Channel A message", agentId: "main" },
        }),
      ),
      POST(
        req("http://localhost:3333/api/openclaw/chat", {
          method: "POST",
          body: { channelId: ch2.id, content: "Channel B message", agentId: "main" },
        }),
      ),
    ]);

    const data1 = await res1.json();
    const data2 = await res2.json();

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(data1.runId).toBeTruthy();
    expect(data2.runId).toBeTruthy();

    // Different session keys for different channels
    expect(data1.sessionKey).not.toBe(data2.sessionKey);
  });
});
