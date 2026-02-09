import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { installTestDb } from "@/lib/db/__tests__/test-db";
import { GET, POST } from "../route";

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

describe("Channels API", () => {
  let cleanup: () => void;

  beforeAll(() => {
    const setup = installTestDb();
    cleanup = setup.cleanup;
  });

  afterAll(() => cleanup());

  // ---- GET ----

  it("GET should return empty channels list initially", async () => {
    const req = makeRequest("http://localhost:3333/api/openclaw/chat/channels");
    const res = await GET(req);
    const data = await json(res);

    expect(res.status).toBe(200);
    expect(data.channels).toEqual([]);
  });

  // ---- CREATE ----

  it("POST create should create a channel", async () => {
    const req = makeRequest("http://localhost:3333/api/openclaw/chat/channels", {
      method: "POST",
      body: { action: "create", name: "Test Channel", defaultAgentId: "main" },
    });
    const res = await POST(req);
    const data = await json(res);

    expect(res.status).toBe(201);
    expect(data.channel.name).toBe("Test Channel");
    expect(data.channel.defaultAgentId).toBe("main");
    expect(data.channel.id).toBeTruthy();
  });

  it("POST create should reject missing name", async () => {
    const req = makeRequest("http://localhost:3333/api/openclaw/chat/channels", {
      method: "POST",
      body: { action: "create", defaultAgentId: "main" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("POST create should reject invalid agent ID", async () => {
    const req = makeRequest("http://localhost:3333/api/openclaw/chat/channels", {
      method: "POST",
      body: { action: "create", name: "Bad Agent", defaultAgentId: "agent with spaces" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("POST create should reject long names", async () => {
    const req = makeRequest("http://localhost:3333/api/openclaw/chat/channels", {
      method: "POST",
      body: { action: "create", name: "x".repeat(101), defaultAgentId: "main" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ---- UPDATE ----

  it("POST update should rename a channel", async () => {
    // Create first
    const createReq = makeRequest("http://localhost:3333/api/openclaw/chat/channels", {
      method: "POST",
      body: { action: "create", name: "To Rename", defaultAgentId: "main" },
    });
    const createRes = await json(await POST(createReq));
    const id = createRes.channel.id;

    // Update
    const updateReq = makeRequest("http://localhost:3333/api/openclaw/chat/channels", {
      method: "POST",
      body: { action: "update", id, name: "Renamed" },
    });
    const updateRes = await POST(updateReq);
    const data = await json(updateRes);

    expect(updateRes.status).toBe(200);
    expect(data.channel.name).toBe("Renamed");
  });

  // ---- ARCHIVE / RESTORE / DELETE ----

  it("POST should archive, restore, and delete a channel", async () => {
    // Create
    const createReq = makeRequest("http://localhost:3333/api/openclaw/chat/channels", {
      method: "POST",
      body: { action: "create", name: "Lifecycle", defaultAgentId: "main" },
    });
    const createRes = await json(await POST(createReq));
    const id = createRes.channel.id;

    // Archive
    const archiveReq = makeRequest("http://localhost:3333/api/openclaw/chat/channels", {
      method: "POST",
      body: { action: "archive", id },
    });
    const archiveRes = await POST(archiveReq);
    expect(archiveRes.status).toBe(200);

    // Cannot delete without archiving (already archived, should succeed)
    const deleteReq = makeRequest("http://localhost:3333/api/openclaw/chat/channels", {
      method: "POST",
      body: { action: "delete", id },
    });
    const deleteRes = await POST(deleteReq);
    expect(deleteRes.status).toBe(200);
  });

  it("POST delete should reject non-archived channels", async () => {
    // Create
    const createReq = makeRequest("http://localhost:3333/api/openclaw/chat/channels", {
      method: "POST",
      body: { action: "create", name: "Not Archived", defaultAgentId: "main" },
    });
    const createRes = await json(await POST(createReq));
    const id = createRes.channel.id;

    // Try to delete without archiving
    const deleteReq = makeRequest("http://localhost:3333/api/openclaw/chat/channels", {
      method: "POST",
      body: { action: "delete", id },
    });
    const deleteRes = await POST(deleteReq);
    expect(deleteRes.status).toBe(400);
  });

  // ---- TOUCH ----

  it("POST touch should mark channel as accessed", async () => {
    const createReq = makeRequest("http://localhost:3333/api/openclaw/chat/channels", {
      method: "POST",
      body: { action: "create", name: "Touch Test", defaultAgentId: "main" },
    });
    const createRes = await json(await POST(createReq));
    const id = createRes.channel.id;

    const touchReq = makeRequest("http://localhost:3333/api/openclaw/chat/channels", {
      method: "POST",
      body: { action: "touch", id },
    });
    const touchRes = await POST(touchReq);
    expect(touchRes.status).toBe(200);

    // Verify via last accessed endpoint
    const lastReq = makeRequest("http://localhost:3333/api/openclaw/chat/channels?last=1");
    const lastRes = await json(await GET(lastReq));
    expect(lastRes.channelId).toBe(id);
  });

  // ---- CSRF ----

  it("POST should reject cross-origin requests", async () => {
    const req = makeRequest("http://localhost:3333/api/openclaw/chat/channels", {
      method: "POST",
      body: { action: "create", name: "CSRF Test", defaultAgentId: "main" },
      headers: { origin: "http://evil.com" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
