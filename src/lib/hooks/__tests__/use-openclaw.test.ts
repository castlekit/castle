/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock SSE singleton
// ---------------------------------------------------------------------------
const sseHandlers: Array<{ pattern: string; handler: (e: unknown) => void }> = [];
const sseErrorHandlers: Array<() => void> = [];

vi.mock("@/lib/sse-singleton", () => ({
  subscribe: (pattern: string, handler: (e: unknown) => void) => {
    const entry = { pattern, handler };
    sseHandlers.push(entry);
    return () => {
      const idx = sseHandlers.indexOf(entry);
      if (idx >= 0) sseHandlers.splice(idx, 1);
    };
  },
  onError: (handler: () => void) => {
    sseErrorHandlers.push(handler);
    return () => {
      const idx = sseErrorHandlers.indexOf(handler);
      if (idx >= 0) sseErrorHandlers.splice(idx, 1);
    };
  },
  getLastEventTimestamp: () => Date.now(),
  isConnected: () => true,
}));

// ---------------------------------------------------------------------------
// SWR mock with data storage
// ---------------------------------------------------------------------------
vi.mock("swr", () => {
  const React = require("react");
  return {
    default: function useSWRMock(
      key: string | null,
      fetcher: (url: string) => Promise<unknown>,
    ) {
      const [data, setData] = React.useState(undefined);
      const [error, setError] = React.useState(null);
      const [loading, setLoading] = React.useState(!!key);

      React.useEffect(() => {
        if (!key) { setData(undefined); setLoading(false); return; }
        setLoading(true);
        fetcher(key)
          .then((d: unknown) => { setData(d); setLoading(false); })
          .catch((err: Error) => { setError(err); setLoading(false); });
      }, [key]);

      const mutate = React.useCallback(
        (updater?: unknown, _opts?: unknown) => {
          if (typeof updater === "function") {
            setData((prev: unknown) => updater(prev));
          } else if (key) {
            fetcher(key).then(setData).catch(setError);
          }
        },
        [key],
      );

      return { data, isLoading: loading, error, mutate };
    },
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useOpenClaw", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    sseHandlers.length = 0;
    sseErrorHandlers.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should fetch connection status on mount", async () => {
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/openclaw/ping")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            configured: true,
            latency_ms: 42,
            server: { version: "1.0.0" },
          }),
        };
      }
      if (typeof url === "string" && url.includes("/api/openclaw/agents")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            agents: [
              { id: "main", name: "Sam", description: null, avatar: null, emoji: null },
            ],
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const { useOpenClaw } = await import("../use-openclaw");
    const { result } = renderHook(() => useOpenClaw());

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });

    expect(result.current.isConfigured).toBe(true);
    expect(result.current.latency).toBe(42);
    expect(result.current.serverVersion).toBe("1.0.0");
  });

  it("should fetch agents when connected", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/openclaw/ping")) {
        return {
          ok: true,
          json: () => Promise.resolve({ ok: true, configured: true }),
        };
      }
      if (typeof url === "string" && url.includes("/api/openclaw/agents")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            agents: [
              { id: "main", name: "Sam", description: "AI Assistant", avatar: null, emoji: "🤖" },
              { id: "reviewer", name: "Code Reviewer", description: null, avatar: null, emoji: null },
            ],
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const { useOpenClaw } = await import("../use-openclaw");
    const { result } = renderHook(() => useOpenClaw());

    await waitFor(() => {
      expect(result.current.agents.length).toBe(2);
    });

    expect(result.current.agents[0].name).toBe("Sam");
    expect(result.current.agents[1].name).toBe("Code Reviewer");
  });

  it("should show disconnected when ping fails", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/openclaw/ping")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            ok: false,
            configured: true,
            state: "error",
            error: "Gateway not running",
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({ agents: [] }) };
    });

    const { useOpenClaw } = await import("../use-openclaw");
    const { result } = renderHook(() => useOpenClaw());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isConnected).toBe(false);
  });

  it("should subscribe to SSE events", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, configured: true, agents: [] }),
    });

    const { useOpenClaw } = await import("../use-openclaw");
    renderHook(() => useOpenClaw());

    await waitFor(() => {
      expect(sseHandlers.length).toBeGreaterThan(0);
    });

    // Should have subscribed to castle.state, agent.*, and agentAvatarUpdated
    const patterns = sseHandlers.map((h) => h.pattern);
    expect(patterns).toContain("castle.state");
    expect(patterns).toContain("agent.*");
    expect(patterns).toContain("agentAvatarUpdated");
  });

  it("should return empty agents when not connected", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/openclaw/ping")) {
        return {
          ok: true,
          json: () => Promise.resolve({ ok: false, configured: false }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const { useOpenClaw } = await import("../use-openclaw");
    const { result } = renderHook(() => useOpenClaw());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.agents).toEqual([]);
  });
});
