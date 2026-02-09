/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

describe("useSearch", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ recent: [], results: [] }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should start with empty state", async () => {
    const { useSearch } = await import("../use-search");
    const { result } = renderHook(() => useSearch());

    expect(result.current.query).toBe("");
    expect(result.current.results).toEqual([]);
    expect(result.current.isSearching).toBe(false);
  });

  it("should load recent searches on mount", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ recent: ["prev search 1", "prev search 2"] }),
    } as Response);

    const { useSearch } = await import("../use-search");
    const { result } = renderHook(() => useSearch());

    // Wait for the initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(result.current.recentSearches).toEqual(["prev search 1", "prev search 2"]);
  });

  it("should debounce search queries", async () => {
    const { useSearch } = await import("../use-search");
    const { result } = renderHook(() => useSearch());

    // Skip the initial recent searches fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    vi.mocked(global.fetch).mockClear();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [{ type: "message", snippet: "test" }] }),
    } as Response);

    // Type query
    act(() => {
      result.current.setQuery("Bitcoin");
    });

    // Should not have fired yet (debounce = 300ms)
    expect(result.current.isSearching).toBe(true);

    // Advance past debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    // Now the fetch should have been called
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/openclaw/chat/search?q=Bitcoin"),
      expect.any(Object)
    );
  });

  it("should clear results when query is empty", async () => {
    const { useSearch } = await import("../use-search");
    const { result } = renderHook(() => useSearch());

    // Skip initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    // Set and clear
    act(() => {
      result.current.setQuery("something");
    });
    act(() => {
      result.current.setQuery("");
    });

    expect(result.current.results).toEqual([]);
    expect(result.current.isSearching).toBe(false);
  });

  it("should clear recent searches", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ recent: ["old search"] }),
    } as Response);

    const { useSearch } = await import("../use-search");
    const { result } = renderHook(() => useSearch());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(result.current.recentSearches).toEqual(["old search"]);

    act(() => {
      result.current.clearRecentSearches();
    });

    expect(result.current.recentSearches).toEqual([]);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/openclaw/chat/search",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
