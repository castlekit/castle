/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock SSE singleton
// ---------------------------------------------------------------------------
const sseSubscribers: Array<{ pattern: string; handler: (e: unknown) => void }> = [];

vi.mock("@/lib/sse-singleton", () => ({
  subscribe: (pattern: string, handler: (e: unknown) => void) => {
    const entry = { pattern, handler };
    sseSubscribers.push(entry);
    return () => {
      const idx = sseSubscribers.indexOf(entry);
      if (idx >= 0) sseSubscribers.splice(idx, 1);
    };
  },
  onError: () => () => {},
  getLastEventTimestamp: () => Date.now(),
  isConnected: () => true,
}));

// Mock agent status setters
const mockSetThinking = vi.fn();
const mockSetActive = vi.fn();
vi.mock("@/lib/hooks/use-agent-status", () => ({
  setAgentThinking: (...args: unknown[]) => mockSetThinking(...args),
  setAgentActive: (...args: unknown[]) => mockSetActive(...args),
  setAgentIdle: vi.fn(),
}));

// ---------------------------------------------------------------------------
// SWR mock
// ---------------------------------------------------------------------------
vi.mock("swr", () => {
  const React = require("react");
  const cacheRef = { current: undefined as unknown };

  return {
    default: function useSWRMock(
      key: string | null,
      fetcher: (url: string) => Promise<unknown>,
    ) {
      const [data, setData] = React.useState(cacheRef.current);
      const [loading, setLoading] = React.useState(!!key && !cacheRef.current);

      React.useEffect(() => {
        if (!key) { setLoading(false); return; }
        setLoading(true);
        fetcher(key)
          .then((d: unknown) => { cacheRef.current = d; setData(d); setLoading(false); })
          .catch(() => setLoading(false));
      }, [key]);

      const mutate = React.useCallback(
        (updater?: unknown) => {
          if (typeof updater === "function") {
            cacheRef.current = (updater as (prev: unknown) => unknown)(cacheRef.current);
            setData(cacheRef.current);
          } else if (key) {
            fetcher(key).then((d: unknown) => { cacheRef.current = d; setData(d); });
          }
        },
        [key],
      );

      return { data, isLoading: loading, error: null, mutate };
    },
    mutate: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useChat", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    sseSubscribers.length = 0;
    mockSetThinking.mockClear();
    mockSetActive.mockClear();

    // Default: history returns empty
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/openclaw/chat") && (!opts || opts.method === "GET" || !opts.method)) {
        return { ok: true, json: () => Promise.resolve({ messages: [], hasMore: false }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should initialize with empty state", async () => {
    const { useChat } = await import("../use-chat");

    const { result } = renderHook(() =>
      useChat({ channelId: "ch-1", defaultAgentId: "main" })
    );

    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.sending).toBe(false);
    expect(result.current.sendError).toBeNull();
    expect(result.current.currentSessionKey).toBeNull();
  });

  it("should load message history", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("channelId=ch-hist")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            messages: [
              { id: "m1", content: "Hello", senderType: "user", sessionKey: "sk-1" },
              { id: "m2", content: "Hi back", senderType: "agent", sessionKey: "sk-1" },
            ],
            hasMore: false,
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({ messages: [], hasMore: false }) };
    });

    const { useChat } = await import("../use-chat");

    const { result } = renderHook(() =>
      useChat({ channelId: "ch-hist", defaultAgentId: "main" })
    );

    await waitFor(() => {
      expect(result.current.messages.length).toBe(2);
    });

    expect(result.current.messages[0].content).toBe("Hello");
    expect(result.current.messages[1].content).toBe("Hi back");
  });

  it("should derive sessionKey from loaded messages", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("channelId=ch-session")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            messages: [
              { id: "m1", content: "Hello", senderType: "user", sessionKey: null },
              { id: "m2", content: "Reply", senderType: "agent", sessionKey: "sk-derived" },
            ],
            hasMore: false,
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({ messages: [], hasMore: false }) };
    });

    const { useChat } = await import("../use-chat");

    const { result } = renderHook(() =>
      useChat({ channelId: "ch-session", defaultAgentId: "main" })
    );

    await waitFor(() => {
      // Session key is derived from the most recent message with one
      expect(result.current.currentSessionKey).toBeTruthy();
    });
  });

  it("should send a message and track the run", async () => {
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      const method = opts?.method || "GET";
      if (method === "POST" && typeof url === "string" && url.includes("/api/openclaw/chat")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            runId: "run-send-1",
            messageId: "msg-1",
            sessionKey: "sk-new",
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({ messages: [], hasMore: false }) };
    });

    const { useChat } = await import("../use-chat");

    const { result } = renderHook(() =>
      useChat({ channelId: "ch-send", defaultAgentId: "main" })
    );

    await act(async () => {
      result.current.sendMessage("Hello agent!");
      await new Promise((r) => setTimeout(r, 50));
    });

    await waitFor(() => {
      expect(result.current.currentSessionKey).toBe("sk-new");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openclaw/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          channelId: "ch-send",
          content: "Hello agent!",
          agentId: "main",
        }),
      })
    );
  });

  it("should set sendError on failed send", async () => {
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      const method = opts?.method || "GET";
      if (method === "POST" && typeof url === "string" && url.includes("/api/openclaw/chat")) {
        return {
          ok: false,
          status: 502,
          json: () => Promise.resolve({ error: "Gateway not connected" }),
        };
      }
      return { ok: true, json: () => Promise.resolve({ messages: [], hasMore: false }) };
    });

    const { useChat } = await import("../use-chat");

    const { result } = renderHook(() =>
      useChat({ channelId: "ch-err", defaultAgentId: "main" })
    );

    await act(async () => {
      await result.current.sendMessage("This will fail");
    });

    await waitFor(() => {
      expect(result.current.sendError).toBeTruthy();
      expect(result.current.sendError).toContain("502");
    });
  });

  it("should not send empty messages", async () => {
    const { useChat } = await import("../use-chat");

    const { result } = renderHook(() =>
      useChat({ channelId: "ch-empty", defaultAgentId: "main" })
    );

    await act(async () => {
      await result.current.sendMessage("");
      await result.current.sendMessage("   ");
    });

    const postCalls = fetchMock.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "POST"
    );
    expect(postCalls.length).toBe(0);
  });

  it("should abort a response", async () => {
    fetchMock.mockImplementation(async (_url: string, opts?: RequestInit) => {
      const method = opts?.method || "GET";
      if (method === "DELETE") {
        return { ok: true, json: () => Promise.resolve({ ok: true }) };
      }
      return { ok: true, json: () => Promise.resolve({ messages: [], hasMore: false }) };
    });

    const { useChat } = await import("../use-chat");

    const { result } = renderHook(() =>
      useChat({ channelId: "ch-abort", defaultAgentId: "main" })
    );

    await act(async () => {
      await result.current.abortResponse();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openclaw/chat",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("should clear send error", async () => {
    fetchMock.mockImplementation(async (_url: string, opts?: RequestInit) => {
      const method = opts?.method || "GET";
      if (method === "POST") {
        return { ok: false, status: 500, json: () => Promise.resolve({ error: "Boom" }) };
      }
      return { ok: true, json: () => Promise.resolve({ messages: [], hasMore: false }) };
    });

    const { useChat } = await import("../use-chat");

    const { result } = renderHook(() =>
      useChat({ channelId: "ch-clear", defaultAgentId: "main" })
    );

    await act(async () => {
      await result.current.sendMessage("fail");
    });

    await waitFor(() => {
      expect(result.current.sendError).toBeTruthy();
    });

    act(() => {
      result.current.clearSendError();
    });

    expect(result.current.sendError).toBeNull();
  });

  it("should deduplicate messages by id", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("channelId=ch-dedup")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            messages: [
              { id: "m1", content: "A", senderType: "user" },
              { id: "m1", content: "A", senderType: "user" },
              { id: "m2", content: "B", senderType: "agent" },
            ],
            hasMore: false,
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({ messages: [], hasMore: false }) };
    });

    const { useChat } = await import("../use-chat");

    const { result } = renderHook(() =>
      useChat({ channelId: "ch-dedup", defaultAgentId: "main" })
    );

    await waitFor(() => {
      expect(result.current.messages.length).toBe(2);
    });
  });

  it("should subscribe to SSE on mount and unsubscribe on unmount", async () => {
    const { useChat } = await import("../use-chat");

    const { unmount } = renderHook(() =>
      useChat({ channelId: "ch-sse", defaultAgentId: "main" })
    );

    expect(sseSubscribers.some((s) => s.pattern === "chat")).toBe(true);

    unmount();

    expect(sseSubscribers.some((s) => s.pattern === "chat")).toBe(false);
  });

  it("should expose pagination state", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("channelId=ch-page")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            messages: [{ id: "m1", content: "First" }],
            hasMore: true,
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({ messages: [], hasMore: false }) };
    });

    const { useChat } = await import("../use-chat");

    const { result } = renderHook(() =>
      useChat({ channelId: "ch-page", defaultAgentId: "main" })
    );

    await waitFor(() => {
      expect(result.current.hasMoreBefore).toBe(true);
    });

    expect(result.current.hasMore).toBe(true); // backward compat alias
    expect(typeof result.current.loadMore).toBe("function");
    expect(typeof result.current.loadOlder).toBe("function");
    expect(typeof result.current.loadNewer).toBe("function");
  });
});
