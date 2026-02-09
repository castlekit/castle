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

describe("Settings API", () => {
  let cleanup: () => void;

  beforeAll(() => {
    const setup = installTestDb();
    cleanup = setup.cleanup;
  });

  afterAll(() => cleanup());

  it("GET should return empty settings initially", async () => {
    const req = makeRequest("http://localhost:3333/api/settings");
    const res = await GET();
    const data = await json(res);

    expect(res.status).toBe(200);
    expect(typeof data).toBe("object");
  });

  it("POST should update a valid setting", async () => {
    const req = makeRequest("http://localhost:3333/api/settings", {
      method: "POST",
      body: { displayName: "Brian" },
    });
    const res = await POST(req);
    const data = await json(res);

    expect(res.status).toBe(200);
    expect(data.displayName).toBe("Brian");
  });

  it("POST should persist settings across reads", async () => {
    // Set
    const setReq = makeRequest("http://localhost:3333/api/settings", {
      method: "POST",
      body: { displayName: "Persistent" },
    });
    await POST(setReq);

    // Read
    const res = await GET();
    const data = await json(res);
    expect(data.displayName).toBe("Persistent");
  });

  it("POST should reject unknown setting keys", async () => {
    const req = makeRequest("http://localhost:3333/api/settings", {
      method: "POST",
      body: { unknownKey: "value" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("POST should reject values exceeding max length", async () => {
    const req = makeRequest("http://localhost:3333/api/settings", {
      method: "POST",
      body: { displayName: "x".repeat(101) },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("POST should reject non-string values", async () => {
    const req = makeRequest("http://localhost:3333/api/settings", {
      method: "POST",
      body: { displayName: 123 },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("POST should reject cross-origin requests", async () => {
    const req = makeRequest("http://localhost:3333/api/settings", {
      method: "POST",
      body: { displayName: "hacked" },
      headers: { origin: "http://evil.com" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("POST should handle tooltips setting", async () => {
    const req = makeRequest("http://localhost:3333/api/settings", {
      method: "POST",
      body: { tooltips: "false" },
    });
    const res = await POST(req);
    const data = await json(res);

    expect(res.status).toBe(200);
    expect(data.tooltips).toBe("false");
  });
});
