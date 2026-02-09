/**
 * Integration test: Full chat lifecycle
 *
 * Tests the complete flow across multiple API routes hitting a shared
 * real test database. Only the Gateway WebSocket is mocked.
 *
 * Flow: create channel -> send message -> complete agent response ->
 *       load history -> search -> archive -> delete
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installTestDb } from "@/lib/db/__tests__/test-db";

// Mock gateway -- the only external dependency
const mockGw = {
  state: "connected" as string,
  isConnected: true,
  isConfigured: true,
  serverInfo: { version: "integration-test" },
  start: vi.fn(),
  stop: vi.fn(),
  request: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  setAvatarUrl: vi.fn(),
  getAvatarUrl: vi.fn(),
};

vi.mock("@/lib/gateway-connection", () => ({
  getGateway: () => mockGw,
  ensureGateway: () => mockGw,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(
  url: string,
  opts?: { method?: string; body?: unknown; headers?: Record<string, string> },
): NextRequest {
  const { method = "GET", body, headers = {} } = opts ?? {};
  const h: Record<string, string> = {
    host: "localhost:3333",
    origin: "http://localhost:3333",
    ...headers,
  };
  if (body) h["content-type"] = "application/json";
  return new NextRequest(new URL(url, "http://localhost:3333"), {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration: Chat Lifecycle", () => {
  let cleanup: () => void;

  // Shared state across the lifecycle
  let channelId: string;
  let userMessageId: string;
  let agentMessageId: string;
  let sessionKey: string;
  const runId = "run-integration-001";

  beforeAll(() => {
    const setup = installTestDb();
    cleanup = setup.cleanup;
  });

  afterAll(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Step 1: Create a channel

  it("Step 1: should create a new channel", async () => {
    const { POST } = await import("@/app/api/openclaw/chat/channels/route");

    const res = await POST(
      makeReq("http://localhost:3333/api/openclaw/chat/channels", {
        method: "POST",
        body: { action: "create", name: "Integration Test Channel", defaultAgentId: "main" },
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.channel.name).toBe("Integration Test Channel");
    channelId = data.channel.id;
  });

  // Step 2: Channel appears in listing

  it("Step 2: should appear in channel list", async () => {
    const { GET } = await import("@/app/api/openclaw/chat/channels/route");

    const res = await GET(makeReq("http://localhost:3333/api/openclaw/chat/channels"));
    const data = await res.json();

    expect(data.channels.some((c: { id: string }) => c.id === channelId)).toBe(true);
  });

  // Step 3: Send a user message

  it("Step 3: should send a user message via chat API", async () => {
    const { POST } = await import("@/app/api/openclaw/chat/route");

    mockGw.request.mockResolvedValue({ runId, status: "ok" });

    const res = await POST(
      makeReq("http://localhost:3333/api/openclaw/chat", {
        method: "POST",
        body: {
          channelId,
          content: "What is Bitcoin mining?",
          agentId: "main",
        },
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.runId).toBe(runId);
    expect(data.messageId).toBeTruthy();
    expect(data.sessionKey).toBeTruthy();

    userMessageId = data.messageId;
    sessionKey = data.sessionKey;

    // Verify gateway was called with the right params
    expect(mockGw.request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        message: "What is Bitcoin mining?",
        sessionKey,
      }),
    );
  });

  // Step 4: Complete the agent response

  it("Step 4: should complete the agent response via PUT", async () => {
    const { PUT } = await import("@/app/api/openclaw/chat/route");

    const res = await PUT(
      makeReq("http://localhost:3333/api/openclaw/chat", {
        method: "PUT",
        body: {
          runId,
          channelId,
          content:
            "Bitcoin mining is the process of validating transactions and adding them to the blockchain using specialized hardware.",
          agentId: "main",
          agentName: "Sam",
          status: "complete",
          sessionKey,
          inputTokens: 42,
          outputTokens: 128,
        },
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.messageId).toBeTruthy();
    expect(data.updated).toBe(false);
    agentMessageId = data.messageId;
  });

  // Step 5: Load history -- both messages should be there

  it("Step 5: should load both messages from history", async () => {
    const { GET } = await import("@/app/api/openclaw/chat/route");

    const res = await GET(
      makeReq(`http://localhost:3333/api/openclaw/chat?channelId=${channelId}`),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.messages.length).toBe(2);

    const user = data.messages.find((m: { id: string }) => m.id === userMessageId);
    const agent = data.messages.find((m: { id: string }) => m.id === agentMessageId);

    expect(user).toBeTruthy();
    expect(user.content).toBe("What is Bitcoin mining?");
    expect(user.senderType).toBe("user");
    expect(user.sessionKey).toBe(sessionKey);

    expect(agent).toBeTruthy();
    expect(agent.content).toContain("validating transactions");
    expect(agent.senderType).toBe("agent");
    expect(agent.status).toBe("complete");
    expect(agent.inputTokens).toBe(42);
    expect(agent.outputTokens).toBe(128);
  });

  // Step 6: Search should find the message

  it("Step 6: should find the message via full-text search", async () => {
    const { GET } = await import("@/app/api/openclaw/chat/search/route");

    const res = await GET(
      makeReq("http://localhost:3333/api/openclaw/chat/search?q=Bitcoin+mining"),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.results.length).toBeGreaterThanOrEqual(1);

    const match = data.results.find(
      (r: { channelId: string }) => r.channelId === channelId,
    );
    expect(match).toBeTruthy();
  });

  // Step 7: Idempotent PUT -- same content should not re-update

  it("Step 7: should handle idempotent PUT (same content)", async () => {
    const { PUT } = await import("@/app/api/openclaw/chat/route");

    const res = await PUT(
      makeReq("http://localhost:3333/api/openclaw/chat", {
        method: "PUT",
        body: {
          runId,
          channelId,
          content:
            "Bitcoin mining is the process of validating transactions and adding them to the blockchain using specialized hardware.",
          agentId: "main",
          status: "complete",
          sessionKey,
        },
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.updated).toBe(false);
  });

  // Step 8: Archive the channel

  it("Step 8: should archive the channel", async () => {
    const { POST } = await import("@/app/api/openclaw/chat/channels/route");

    const res = await POST(
      makeReq("http://localhost:3333/api/openclaw/chat/channels", {
        method: "POST",
        body: { action: "archive", id: channelId },
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  // Step 9: Archived channel should not appear in default listing

  it("Step 9: archived channel should not appear in default listing", async () => {
    const { GET } = await import("@/app/api/openclaw/chat/channels/route");

    const res = await GET(makeReq("http://localhost:3333/api/openclaw/chat/channels"));
    const data = await res.json();

    expect(data.channels.every((c: { id: string }) => c.id !== channelId)).toBe(true);
  });

  // Step 10: But should appear in archived listing

  it("Step 10: archived channel should appear in archived listing", async () => {
    const { GET } = await import("@/app/api/openclaw/chat/channels/route");

    const res = await GET(
      makeReq("http://localhost:3333/api/openclaw/chat/channels?archived=1"),
    );
    const data = await res.json();

    expect(data.channels.some((c: { id: string }) => c.id === channelId)).toBe(true);
  });

  // Step 11: Delete the archived channel

  it("Step 11: should delete the archived channel", async () => {
    const { POST } = await import("@/app/api/openclaw/chat/channels/route");

    const res = await POST(
      makeReq("http://localhost:3333/api/openclaw/chat/channels", {
        method: "POST",
        body: { action: "delete", id: channelId },
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  // Step 12: History should be empty after deletion

  it("Step 12: history should be empty after channel deletion", async () => {
    const { GET } = await import("@/app/api/openclaw/chat/route");

    const res = await GET(
      makeReq(`http://localhost:3333/api/openclaw/chat?channelId=${channelId}`),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.messages.length).toBe(0);
  });
});
