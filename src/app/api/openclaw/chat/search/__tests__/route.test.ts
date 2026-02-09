import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { installTestDb } from "@/lib/db/__tests__/test-db";
import { GET, POST, DELETE } from "../route";

// ============================================================================
// Helpers
// ============================================================================

function makeRequest(
  url: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string> }
): NextRequest {
  const { method = "GET", body, headers = {} } = options ?? {};
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

describe("Search API", () => {
  let cleanup: () => void;

  beforeAll(async () => {
    const setup = installTestDb();
    cleanup = setup.cleanup;

    // Seed some messages for searching
    const { createChannel, createMessage } = await import("@/lib/db/queries");
    const ch = createChannel("Search API Test", "main");

    createMessage({ channelId: ch.id, senderType: "user", senderId: "u1", content: "Bitcoin is digital gold" });
    createMessage({ channelId: ch.id, senderType: "agent", senderId: "main", senderName: "Sam", content: "Lightning network is fast" });
    createMessage({ channelId: ch.id, senderType: "user", senderId: "u1", content: "What about ordinals?" });
  });

  afterAll(() => cleanup());

  // ---- Search ----

  it("GET should return results for a matching query", async () => {
    const req = makeRequest("http://localhost:3333/api/openclaw/chat/search?q=Bitcoin");
    const res = await GET(req);
    const data = await json(res);

    expect(res.status).toBe(200);
    expect(data.results.length).toBeGreaterThanOrEqual(1);
    expect(data.results[0].type).toBe("message");
    expect(data.results[0].snippet).toContain("Bitcoin");
  });

  it("GET should return empty results for no match", async () => {
    const req = makeRequest("http://localhost:3333/api/openclaw/chat/search?q=zzz_no_match_zzz");
    const res = await GET(req);
    const data = await json(res);

    expect(data.results).toEqual([]);
  });

  it("GET should return empty for missing query", async () => {
    const req = makeRequest("http://localhost:3333/api/openclaw/chat/search");
    const res = await GET(req);
    const data = await json(res);

    expect(data.results).toEqual([]);
  });

  it("GET should reject overly long queries", async () => {
    const req = makeRequest(`http://localhost:3333/api/openclaw/chat/search?q=${"a".repeat(501)}`);
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  // ---- Recent Searches ----

  it("GET recent should return recent searches", async () => {
    const req = makeRequest("http://localhost:3333/api/openclaw/chat/search?recent=1");
    const res = await GET(req);
    const data = await json(res);

    expect(res.status).toBe(200);
    expect(Array.isArray(data.recent)).toBe(true);
  });

  it("POST should save a recent search", async () => {
    const req = makeRequest("http://localhost:3333/api/openclaw/chat/search", {
      method: "POST",
      body: { query: "saved search" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify it was saved
    const recentReq = makeRequest("http://localhost:3333/api/openclaw/chat/search?recent=1");
    const data = await json(await GET(recentReq));
    expect(data.recent).toContain("saved search");
  });

  it("POST should reject empty query", async () => {
    const req = makeRequest("http://localhost:3333/api/openclaw/chat/search", {
      method: "POST",
      body: { query: "" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("DELETE should clear all recent searches", async () => {
    // Add one first
    const addReq = makeRequest("http://localhost:3333/api/openclaw/chat/search", {
      method: "POST",
      body: { query: "to clear" },
    });
    await POST(addReq);

    // Clear
    const delReq = makeRequest("http://localhost:3333/api/openclaw/chat/search", {
      method: "DELETE",
    });
    const delRes = await DELETE(delReq);
    expect(delRes.status).toBe(200);

    // Verify empty
    const recentReq = makeRequest("http://localhost:3333/api/openclaw/chat/search?recent=1");
    const data = await json(await GET(recentReq));
    expect(data.recent.length).toBe(0);
  });
});
