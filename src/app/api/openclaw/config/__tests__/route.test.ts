import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock filesystem
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

// Mock gateway
vi.mock("@/lib/gateway-connection", () => {
  const mockGateway = {
    state: "connected",
    isConnected: true,
    request: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  return {
    ensureGateway: () => mockGateway,
    __mockGateway: mockGateway,
  };
});

import { readFileSync, existsSync } from "fs";

function makeRequest(url: string, opts?: { method?: string; body?: unknown; headers?: Record<string, string> }): NextRequest {
  const { method = "GET", body, headers = {} } = opts ?? {};
  const h: Record<string, string> = { host: "localhost:3333", origin: "http://localhost:3333", ...headers };
  if (body) h["content-type"] = "application/json";
  return new NextRequest(new URL(url, "http://localhost:3333"), {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  } as never);
}

describe("Config API", () => {
  let mockGateway: { isConnected: boolean; request: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const gw = await import("@/lib/gateway-connection");
    mockGateway = (gw as unknown as { __mockGateway: typeof mockGateway }).__mockGateway;
    mockGateway.isConnected = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- GET ----

  it("GET should return config from openclaw.json", async () => {
    const { GET } = await import("../route");

    vi.mocked(existsSync).mockImplementation((p) => String(p).includes("openclaw.json"));
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        agents: { defaults: { contextTokens: 200000 } },
        gateway: { port: 18789, auth: { token: "rew_secret123" } },
      })
    );

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.format).toBe("json");
    // Token should be redacted
    expect(data.config.gateway.auth.token).toBe("rew_***");
    // Non-sensitive values should be present
    expect(data.config.gateway.port).toBe(18789);
    expect(data.config.agents.defaults.contextTokens).toBe(200000);
  });

  it("GET should redact secrets from config", async () => {
    const { GET } = await import("../route");

    vi.mocked(existsSync).mockImplementation((p) => String(p).includes("openclaw.json"));
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        gateway: {
          auth: {
            token: "rew_abc123",
            secret: "super_secret_val",
            apiKey: "key_12345",
          },
        },
      })
    );

    const res = await GET();
    const data = await res.json();

    expect(data.config.gateway.auth.token).toBe("rew_***");
    expect(data.config.gateway.auth.secret).toBe("supe***");
    expect(data.config.gateway.auth.apiKey).toBe("key_***");
  });

  it("GET should return 404 when no config exists", async () => {
    const { GET } = await import("../route");

    vi.mocked(existsSync).mockReturnValue(false);

    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("GET should handle json5 format", async () => {
    const { GET } = await import("../route");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("openclaw.json")) return false;
      if (path.endsWith("openclaw.json5")) return true;
      return false;
    });
    vi.mocked(readFileSync).mockReturnValue('{ port: 18789 }');

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.format).toBe("json5");
    expect(data.config.port).toBe(18789);
  });

  // ---- PATCH ----

  it("PATCH should forward to gateway config.patch", async () => {
    const { PATCH } = await import("../route");

    mockGateway.request.mockResolvedValue({});

    const req = makeRequest("http://localhost:3333/api/openclaw/config", {
      method: "PATCH",
      body: { patch: { agents: { defaults: { contextTokens: 100000 } } } },
    });

    const res = await PATCH(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mockGateway.request).toHaveBeenCalledWith(
      "config.patch",
      { agents: { defaults: { contextTokens: 100000 } } }
    );
  });

  it("PATCH should reject missing patch field", async () => {
    const { PATCH } = await import("../route");

    const req = makeRequest("http://localhost:3333/api/openclaw/config", {
      method: "PATCH",
      body: { notPatch: "bad" },
    });

    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("PATCH should reject cross-origin", async () => {
    const { PATCH } = await import("../route");

    const req = makeRequest("http://localhost:3333/api/openclaw/config", {
      method: "PATCH",
      body: { patch: {} },
      headers: { origin: "http://evil.com" },
    });

    const res = await PATCH(req);
    expect(res.status).toBe(403);
  });

  it("PATCH should return 503 when gateway disconnected", async () => {
    const { PATCH } = await import("../route");

    mockGateway.isConnected = false;

    const req = makeRequest("http://localhost:3333/api/openclaw/config", {
      method: "PATCH",
      body: { patch: { foo: "bar" } },
    });

    const res = await PATCH(req);
    expect(res.status).toBe(503);
  });
});
