import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the gateway
vi.mock("@/lib/gateway-connection", () => {
  const mockGateway = {
    state: "connected" as string,
    isConnected: true,
    isConfigured: true,
    serverInfo: { version: "1.0.0", connId: "test-conn" },
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

describe("Ping API", () => {
  let mockGateway: {
    state: string;
    isConnected: boolean;
    isConfigured: boolean;
    serverInfo: Record<string, unknown>;
    request: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const gw = await import("@/lib/gateway-connection");
    mockGateway = (gw as unknown as { __mockGateway: typeof mockGateway }).__mockGateway;
    // Reset defaults
    mockGateway.state = "connected";
    mockGateway.isConnected = true;
    mockGateway.isConfigured = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST should return ok:true when healthy", async () => {
    const { POST } = await import("../route");

    mockGateway.request.mockResolvedValue({});

    const res = await POST();
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.configured).toBe(true);
    expect(typeof data.latency_ms).toBe("number");
    expect(data.server).toBeDefined();
  });

  it("POST should return ok:false when not configured", async () => {
    const { POST } = await import("../route");

    mockGateway.isConfigured = false;

    const res = await POST();
    const data = await res.json();

    expect(data.ok).toBe(false);
    expect(data.configured).toBe(false);
    expect(data.error).toContain("No OpenClaw token");
  });

  it("POST should return ok:false when disconnected", async () => {
    const { POST } = await import("../route");

    mockGateway.isConnected = false;
    mockGateway.state = "error";

    const res = await POST();
    const data = await res.json();

    expect(data.ok).toBe(false);
    expect(data.configured).toBe(true);
    expect(data.error).toContain("Failed to connect");
  });

  it("POST should handle health check failure", async () => {
    const { POST } = await import("../route");

    mockGateway.request.mockRejectedValue(new Error("Request timeout: health"));

    const res = await POST();
    const data = await res.json();

    expect(data.ok).toBe(false);
    expect(data.error).toContain("Request timeout");
  });

  it("GET should return same result as POST", async () => {
    const { GET } = await import("../route");

    mockGateway.request.mockResolvedValue({});

    const res = await GET();
    const data = await res.json();

    expect(data.ok).toBe(true);
  });
});
