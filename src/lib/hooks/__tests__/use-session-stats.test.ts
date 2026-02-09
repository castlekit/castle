/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// Minimal SWR mock that actually calls the fetcher
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
        if (!key) {
          setData(undefined);
          setLoading(false);
          return;
        }
        setLoading(true);
        fetcher(key)
          .then((d: unknown) => { setData(d); setLoading(false); })
          .catch((err: Error) => { setError(err); setLoading(false); });
      }, [key]);

      const mutate = React.useCallback(() => {
        if (key) fetcher(key).then(setData).catch(setError);
      }, [key]);

      return { data, isLoading: loading, error, mutate };
    },
  };
});

describe("useSessionStats", () => {
  beforeEach(() => {
    vi.resetModules();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return null stats when sessionKey is null", async () => {
    const { useSessionStats } = await import("../use-session-stats");
    const { result } = renderHook(() => useSessionStats({ sessionKey: null }));

    expect(result.current.stats).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should fetch and return stats when sessionKey provided", async () => {
    const mockStats = {
      sessionKey: "agent:main:castle:abc",
      sessionId: "sess-1",
      agentId: "main",
      model: "claude-sonnet-4-20250514",
      modelProvider: "anthropic",
      tokens: { input: 5000, output: 2000, total: 7000 },
      context: { used: 7000, limit: 200000, modelMax: 1000000, percentage: 4 },
      compactions: 1,
      thinkingLevel: "high",
      updatedAt: Date.now(),
    };

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockStats),
    } as Response);

    const { useSessionStats } = await import("../use-session-stats");
    const { result } = renderHook(() =>
      useSessionStats({ sessionKey: "agent:main:castle:abc" })
    );

    await waitFor(() => {
      expect(result.current.stats).not.toBeNull();
    });

    expect(result.current.stats!.sessionKey).toBe("agent:main:castle:abc");
    expect(result.current.stats!.tokens.total).toBe(7000);
    expect(result.current.isError).toBe(false);
  });

  it("should set isError on fetch failure", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("Network error"));

    const { useSessionStats } = await import("../use-session-stats");
    const { result } = renderHook(() =>
      useSessionStats({ sessionKey: "agent:main:castle:err" })
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
