"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { SearchResult } from "@/lib/types/search";

// ============================================================================
// Constants
// ============================================================================

const DEBOUNCE_MS = 300;

// ============================================================================
// Hook
// ============================================================================

export function useSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recentLoaded = useRef(false);

  // Load recent searches from DB on first mount
  useEffect(() => {
    if (recentLoaded.current) return;
    recentLoaded.current = true;
    fetch("/api/openclaw/chat/search?recent=1")
      .then((res) => (res.ok ? res.json() : { recent: [] }))
      .then((data) => setRecentSearches(data.recent ?? []))
      .catch(() => {});
  }, []);

  // Debounced search
  const search = useCallback((q: string) => {
    setQuery(q);

    // Cancel pending request
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!q.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(
          `/api/openclaw/chat/search?q=${encodeURIComponent(q.trim())}`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const data = await res.json();
          const searchResults: SearchResult[] = data.results ?? [];
          setResults(searchResults);

          // Save to recent searches in DB if results found
          if (searchResults.length > 0) {
            const trimmed = q.trim();
            fetch("/api/openclaw/chat/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query: trimmed }),
            })
              .then(() => {
                // Update local state to reflect the save
                setRecentSearches((prev) => {
                  const filtered = prev.filter((s) => s !== trimmed);
                  return [trimmed, ...filtered].slice(0, 15);
                });
              })
              .catch(() => {});
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("[useSearch] Search failed:", (err as Error).message);
          setResults([]);
        }
      } finally {
        setIsSearching(false);
      }
    }, DEBOUNCE_MS);
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    fetch("/api/openclaw/chat/search", { method: "DELETE" }).catch(() => {});
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return {
    query,
    setQuery: search,
    results,
    isSearching,
    recentSearches,
    clearRecentSearches,
  };
}
