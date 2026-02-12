import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the gateway
vi.mock("@/lib/gateway-connection", () => {
  const mockGw = {
    state: "connected" as string,
    isConnected: true,
    isConfigured: true,
    serverInfo: { version: "1.0.0" },
    start: vi.fn(),
    stop: vi.fn(),
    request: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    setAvatarUrl: vi.fn(),
    getAvatarUrl: vi.fn(),
  };
  return {
    getGateway: () => mockGw,
    ensureGateway: () => mockGw,
    __mockGw: mockGw,
  };
});

describe("Agents API", () => {
  let mockGw: {
    state: string;
    isConnected: boolean;
    request: ReturnType<typeof vi.fn>;
    setAvatarUrl: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const gw = await import("@/lib/gateway-connection");
    mockGw = (gw as unknown as { __mockGw: typeof mockGw }).__mockGw;
    mockGw.state = "connected";
    mockGw.isConnected = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET should return agents list", async () => {
    const { GET } = await import("../route");

    mockGw.request.mockImplementation(async (method: string) => {
      if (method === "agents.list") {
        return {
          defaultId: "main",
          agents: [
            { id: "main", identity: { name: "Sam", theme: "AI Assistant", emoji: "\uD83E\uDD16" } },
            { id: "reviewer", identity: { name: "Code Reviewer" } },
          ],
        };
      }
      if (method === "config.get") {
        return { hash: "h1", parsed: { agents: { list: [{ id: "main", workspace: "/home/code" }] } } };
      }
      return {};
    });

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.agents.length).toBe(2);
    expect(data.agents[0].name).toBe("Sam");
    expect(data.agents[0].description).toBe("AI Assistant");
    expect(data.agents[1].name).toBe("Code Reviewer");
    expect(data.defaultId).toBe("main");
  });

  it("GET should return 503 when not connected", async () => {
    const { GET } = await import("../route");

    mockGw.isConnected = false;
    mockGw.state = "disconnected";

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toContain("Gateway not connected");
    expect(data.agents).toEqual([]);
  });

  it("GET should handle agents.list failure", async () => {
    const { GET } = await import("../route");

    mockGw.request.mockRejectedValue(new Error("Request timeout"));

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toContain("Request timeout");
  });

  it("GET should handle config.get failure gracefully", async () => {
    const { GET } = await import("../route");

    mockGw.request.mockImplementation(async (method: string) => {
      if (method === "agents.list") {
        return { agents: [{ id: "main", identity: { name: "Sam" } }] };
      }
      if (method === "config.get") throw new Error("config not available");
      return {};
    });

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.agents.length).toBe(1);
  });

  it("GET should resolve avatar URLs through proxy", async () => {
    const { GET } = await import("../route");

    mockGw.request.mockImplementation(async (method: string) => {
      if (method === "agents.list") {
        return {
          agents: [{
            id: "main",
            identity: { name: "Sam", avatarUrl: "http://gw:18789/api/v1/avatars/abc123def" },
          }],
        };
      }
      if (method === "config.get") return { parsed: {} };
      return {};
    });

    const res = await GET();
    const data = await res.json();

    expect(data.agents[0].avatar).toBe("/api/avatars/abc123def");
    expect(mockGw.setAvatarUrl).toHaveBeenCalledWith("abc123def", "http://gw:18789/api/v1/avatars/abc123def");
  });

  it("GET should resolve absolute paths under ~/.castle/avatars/", async () => {
    const { homedir } = await import("os");
    const { join } = await import("path");
    const castleAvatarPath = join(homedir(), ".castle", "avatars", "main.png");

    const { GET } = await import("../route");

    mockGw.request.mockImplementation(async (method: string) => {
      if (method === "agents.list") {
        return {
          agents: [{ id: "main", identity: { name: "Sam", avatar: castleAvatarPath } }],
        };
      }
      if (method === "config.get") return { parsed: {} };
      return {};
    });

    const res = await GET();
    const data = await res.json();

    expect(data.agents[0].avatar).toBe("/api/avatars/main");
  });

  it("GET should pass through data URIs", async () => {
    const { GET } = await import("../route");

    mockGw.request.mockImplementation(async (method: string) => {
      if (method === "agents.list") {
        return {
          agents: [{ id: "main", identity: { name: "Sam", avatar: "data:image/png;base64,abc" } }],
        };
      }
      if (method === "config.get") return { parsed: {} };
      return {};
    });

    const res = await GET();
    const data = await res.json();

    expect(data.agents[0].avatar).toBe("data:image/png;base64,abc");
  });

  it("GET should use agent ID as fallback name", async () => {
    const { GET } = await import("../route");

    mockGw.request.mockImplementation(async (method: string) => {
      if (method === "agents.list") return { agents: [{ id: "unnamed-agent" }] };
      if (method === "config.get") return { parsed: {} };
      return {};
    });

    const res = await GET();
    const data = await res.json();

    expect(data.agents[0].name).toBe("unnamed-agent");
  });
});
