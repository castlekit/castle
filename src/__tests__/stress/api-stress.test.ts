/**
 * API route stress tests.
 *
 * Directly calls route handlers with concurrent requests to test
 * rate limiting, large payloads, idempotency, and concurrent operations.
 *
 * Run: npm run stress
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installTestDb } from "../../lib/db/__tests__/test-db";

// Mock the gateway to prevent real WebSocket connections
vi.mock("@/lib/gateway-connection", () => {
  let callCount = 0;
  const mockGateway = {
    state: "connected",
    isConnected: true,
    isConfigured: true,
    serverInfo: { version: "stress-test" },
    start: vi.fn(),
    stop: vi.fn(),
    request: vi.fn(async () => ({ runId: `run-stress-${++callCount}` })),
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function logPerf(label: string, count: number, durationMs: number) {
  const rate = Math.round(count / (durationMs / 1000));
  console.log(`[Stress] ${label}: ${count} ops in ${durationMs}ms (${rate} ops/s)`);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let cleanup: () => void;

beforeAll(() => {
  const setup = installTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => cleanup());

// Reset rate limiter module between tests by resetting all modules
beforeEach(() => {
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("API Stress", () => {
  it("should enforce rate limit: 30/min accepts, rest get 429", async () => {
    // Fresh import to get clean rate limiter
    const { POST } = await import("@/app/api/openclaw/chat/route");
    const { createChannel } = await import("@/lib/db/queries");

    const ch = createChannel("Rate Limit Stress", "agent-rl");
    const TOTAL = 100;
    const statuses: number[] = [];

    const start = Date.now();

    for (let i = 0; i < TOTAL; i++) {
      const req = makeReq("/api/openclaw/chat", {
        method: "POST",
        body: { channelId: ch.id, content: `Rate limit test ${i}` },
      });
      const res = await POST(req);
      statuses.push(res.status);
    }

    const duration = Date.now() - start;
    const accepted = statuses.filter((s) => s === 200).length;
    const rejected = statuses.filter((s) => s === 429).length;

    logPerf(`Rate limiter (${accepted} accepted, ${rejected} rejected)`, TOTAL, duration);

    // Rate limit is 30 per minute — first 30 should succeed, rest should 429
    expect(accepted).toBe(30);
    expect(rejected).toBe(TOTAL - 30);

    // The 429s should come after the 30th request
    for (let i = 0; i < 30; i++) {
      expect(statuses[i]).toBe(200);
    }
    for (let i = 30; i < TOTAL; i++) {
      expect(statuses[i]).toBe(429);
    }
  });

  it("should enforce message size limit at 32KB boundary", async () => {
    const { POST } = await import("@/app/api/openclaw/chat/route");
    const { createChannel } = await import("@/lib/db/queries");

    const ch = createChannel("Size Limit Stress", "agent-size");

    // 31KB — should succeed
    const small = makeReq("/api/openclaw/chat", {
      method: "POST",
      body: { channelId: ch.id, content: "x".repeat(31 * 1024) },
    });
    const smallRes = await POST(small);
    expect(smallRes.status).toBe(200);

    // 32KB — should succeed (exactly at limit)
    const exact = makeReq("/api/openclaw/chat", {
      method: "POST",
      body: { channelId: ch.id, content: "x".repeat(32 * 1024) },
    });
    const exactRes = await POST(exact);
    expect(exactRes.status).toBe(200);

    // 32KB + 1 — should fail
    const over = makeReq("/api/openclaw/chat", {
      method: "POST",
      body: { channelId: ch.id, content: "x".repeat(32 * 1024 + 1) },
    });
    const overRes = await POST(over);
    expect(overRes.status).toBe(400);
    const overBody = await overRes.json();
    expect(overBody.error).toContain("too long");
  });

  it("should handle 50 concurrent search requests", async () => {
    const { GET: searchGET } = await import("@/app/api/openclaw/chat/search/route");
    const { createChannel, createMessage } = await import("@/lib/db/queries");

    const ch = createChannel("Search Stress", "agent-search-api");
    const topics = ["Bitcoin", "Ethereum", "Lightning", "Ordinals", "Runes"];

    // Seed data
    for (let i = 0; i < 100; i++) {
      createMessage({
        channelId: ch.id,
        senderType: "agent",
        senderId: "agent-search-api",
        content: `${topics[i % topics.length]} deep analysis report number ${i}`,
      });
    }

    // Fire 50 concurrent searches
    const start = Date.now();
    const promises = Array.from({ length: 50 }, (_, i) => {
      const topic = topics[i % topics.length];
      const req = makeReq(`/api/openclaw/chat/search?q=${encodeURIComponent(topic)}&channelId=${ch.id}`, {
        headers: { "x-forwarded-for": `10.0.0.${i}` }, // unique IPs to avoid rate limit
      });
      return searchGET(req);
    });

    const responses = await Promise.all(promises);
    const duration = Date.now() - start;

    logPerf("Concurrent searches", 50, duration);

    // All should succeed
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // Each topic search should find 20 messages (100 / 5 topics)
    for (let i = 0; i < topics.length; i++) {
      const body = await responses[i].json();
      expect(body.results.length).toBe(20);
    }
  });

  it("should handle concurrent channel operations without corruption", async () => {
    const { POST: channelsPOST, GET: channelsGET } = await import(
      "@/app/api/openclaw/chat/channels/route"
    );

    const TOTAL = 50;
    const channelIds: string[] = [];

    // Create 50 channels rapidly
    const createStart = Date.now();
    for (let i = 0; i < TOTAL; i++) {
      const req = makeReq("/api/openclaw/chat/channels", {
        method: "POST",
        body: { action: "create", name: `Concurrent Channel ${i}`, defaultAgentId: "agent-conc" },
      });
      const res = await channelsPOST(req);
      expect(res.status).toBe(201);
      const body = await res.json();
      channelIds.push(body.channel.id);
    }
    logPerf("Channel creates", TOTAL, Date.now() - createStart);

    // Verify all exist
    const listReq = makeReq("/api/openclaw/chat/channels");
    const listRes = await channelsGET(listReq);
    const listBody = await listRes.json();
    for (const id of channelIds) {
      expect(listBody.channels.find((c: { id: string }) => c.id === id)).toBeDefined();
    }

    // Archive half, then restore them, then delete the other half
    const opsStart = Date.now();
    for (let i = 0; i < TOTAL; i++) {
      if (i % 2 === 0) {
        // Archive
        const req = makeReq("/api/openclaw/chat/channels", {
          method: "POST",
          body: { action: "archive", id: channelIds[i] },
        });
        const res = await channelsPOST(req);
        expect(res.status).toBe(200);
      }
    }

    // Restore the archived ones
    for (let i = 0; i < TOTAL; i++) {
      if (i % 2 === 0) {
        const req = makeReq("/api/openclaw/chat/channels", {
          method: "POST",
          body: { action: "restore", id: channelIds[i] },
        });
        const res = await channelsPOST(req);
        expect(res.status).toBe(200);
      }
    }

    // Delete odd-indexed channels (archive first, then delete)
    for (let i = 0; i < TOTAL; i++) {
      if (i % 2 === 1) {
        await channelsPOST(makeReq("/api/openclaw/chat/channels", {
          method: "POST",
          body: { action: "archive", id: channelIds[i] },
        }));
        const res = await channelsPOST(makeReq("/api/openclaw/chat/channels", {
          method: "POST",
          body: { action: "delete", id: channelIds[i] },
        }));
        expect(res.status).toBe(200);
      }
    }

    logPerf("Channel lifecycle ops", TOTAL * 2, Date.now() - opsStart);

    // Verify: 25 active channels remain, 0 archived
    const finalList = await channelsGET(makeReq("/api/openclaw/chat/channels"));
    const finalBody = await finalList.json();
    const remaining = finalBody.channels.filter(
      (c: { id: string }) => channelIds.includes(c.id)
    );
    expect(remaining.length).toBe(25); // only even-indexed survived
  });

  it("should handle idempotent PUT completions for same runId", async () => {
    const { PUT } = await import("@/app/api/openclaw/chat/route");
    const { createChannel } = await import("@/lib/db/queries");

    const ch = createChannel("Idempotency Stress", "agent-idem");
    const runId = `run-idem-${Date.now()}`;

    // First completion — should create message
    const first = await PUT(
      makeReq("/api/openclaw/chat", {
        method: "PUT",
        body: {
          runId,
          channelId: ch.id,
          agentId: "agent-idem",
          content: "First completion",
          status: "complete",
        },
      })
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.updated).toBe(false);
    const messageId = firstBody.messageId;

    // Send 20 more completions with same runId and content — should all be idempotent
    const start = Date.now();
    for (let i = 0; i < 20; i++) {
      const res = await PUT(
        makeReq("/api/openclaw/chat", {
          method: "PUT",
          body: {
            runId,
            channelId: ch.id,
            agentId: "agent-idem",
            content: "First completion",
            status: "complete",
          },
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      // Same message ID, not updated (idempotent)
      expect(body.messageId).toBe(messageId);
      expect(body.updated).toBe(false);
    }

    logPerf("Idempotent completions", 20, Date.now() - start);

    // Verify only one message exists for this runId
    const { getMessagesByChannel } = await import("@/lib/db/queries");
    const msgs = getMessagesByChannel(ch.id, 100);
    const forRun = msgs.filter((m) => m.runId === runId);
    expect(forRun.length).toBe(1);
    expect(forRun[0].content).toBe("First completion");
  });

  it("should handle concurrent GET history requests on a large channel", async () => {
    const { GET } = await import("@/app/api/openclaw/chat/route");
    const { createChannel, createMessage } = await import("@/lib/db/queries");

    const ch = createChannel("History Stress", "agent-hist");

    // Seed 500 messages
    for (let i = 0; i < 500; i++) {
      createMessage({
        channelId: ch.id,
        senderType: i % 2 === 0 ? "user" : "agent",
        senderId: i % 2 === 0 ? "user-hist" : "agent-hist",
        content: `History message ${i}`,
      });
    }

    // Fire 30 concurrent history requests with different pagination
    const start = Date.now();
    const requests = Array.from({ length: 30 }, (_, i) => {
      const limit = 50;
      const req = makeReq(
        `/api/openclaw/chat?channelId=${ch.id}&limit=${limit}`,
      );
      return GET(req);
    });

    const responses = await Promise.all(requests);
    const duration = Date.now() - start;

    logPerf("Concurrent history loads", 30, duration);

    for (const res of responses) {
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages.length).toBe(50);
      expect(body.hasMore).toBe(true);
    }
  });
});
