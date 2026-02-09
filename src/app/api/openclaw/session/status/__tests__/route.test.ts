import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock filesystem and config
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
  };
});

vi.mock("@/lib/config", () => ({
  getOpenClawDir: () => "/tmp/mock-openclaw",
}));

import { readFileSync, existsSync } from "fs";

// ============================================================================
// Helpers
// ============================================================================

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3333"));
}

async function json(res: Response) {
  return res.json();
}

// ============================================================================
// Tests
// ============================================================================

describe("Session Status API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 400 if sessionKey is missing", async () => {
    const { GET } = await import("../route");

    const req = makeRequest("http://localhost:3333/api/openclaw/session/status");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("should return 400 for unparseable sessionKey", async () => {
    const { GET } = await import("../route");

    // No "agent:" prefix
    const req = makeRequest("http://localhost:3333/api/openclaw/session/status?sessionKey=invalid");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("should return 204 when session file does not exist", async () => {
    const { GET } = await import("../route");

    vi.mocked(existsSync).mockReturnValue(false);

    const req = makeRequest(
      "http://localhost:3333/api/openclaw/session/status?sessionKey=agent:main:castle:abc"
    );
    const res = await GET(req);
    expect(res.status).toBe(204);
  });

  it("should return session stats when data exists", async () => {
    const { GET } = await import("../route");

    const sessionData = {
      "agent:main:castle:abc": {
        sessionId: "sess-123",
        model: "claude-sonnet-4-20250514",
        modelProvider: "anthropic",
        inputTokens: 5000,
        outputTokens: 2000,
        totalTokens: 7000,
        contextTokens: 1000000,
        compactionCount: 1,
        thinkingLevel: "high",
        updatedAt: Date.now(),
      },
    };

    // sessions.json exists
    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      if (path.includes("sessions.json")) return true;
      if (path.includes("openclaw.json")) return false;
      if (path.includes("openclaw.json5")) return false;
      return false;
    });

    vi.mocked(readFileSync).mockImplementation((p) => {
      const path = String(p);
      if (path.includes("sessions.json")) {
        return JSON.stringify(sessionData);
      }
      throw new Error(`Unexpected read: ${path}`);
    });

    const req = makeRequest(
      "http://localhost:3333/api/openclaw/session/status?sessionKey=agent:main:castle:abc"
    );
    const res = await GET(req);
    const data = await json(res);

    expect(res.status).toBe(200);
    expect(data.sessionKey).toBe("agent:main:castle:abc");
    expect(data.agentId).toBe("main");
    expect(data.model).toBe("claude-sonnet-4-20250514");
    expect(data.tokens.input).toBe(5000);
    expect(data.tokens.output).toBe(2000);
    expect(data.tokens.total).toBe(7000);
    expect(data.context.used).toBe(7000);
    expect(data.context.limit).toBe(200000); // default
    expect(data.context.percentage).toBe(4); // 7000/200000 ~ 3.5% → rounds to 4
    expect(data.compactions).toBe(1);
  });

  it("should resolve context limit from config", async () => {
    const { GET } = await import("../route");

    const sessionData = {
      "agent:main:castle:def": {
        totalTokens: 50000,
        contextTokens: 1000000,
        updatedAt: Date.now(),
      },
    };

    const configData = {
      agents: {
        defaults: {
          contextTokens: 100000,
        },
      },
    };

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      if (path.includes("sessions.json")) return true;
      if (path.includes("openclaw.json")) return true;
      return false;
    });

    vi.mocked(readFileSync).mockImplementation((p) => {
      const path = String(p);
      if (path.includes("sessions.json")) return JSON.stringify(sessionData);
      if (path.includes("openclaw.json")) return JSON.stringify(configData);
      throw new Error(`Unexpected read: ${path}`);
    });

    const req = makeRequest(
      "http://localhost:3333/api/openclaw/session/status?sessionKey=agent:main:castle:def"
    );
    const res = await GET(req);
    const data = await json(res);

    expect(data.context.limit).toBe(100000);
    expect(data.context.percentage).toBe(50); // 50000/100000
  });
});
