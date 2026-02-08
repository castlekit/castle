"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { SearchResult } from "@/lib/types/search";

// ============================================================================
// Constants
// ============================================================================

const DEBOUNCE_MS = 300;
const MAX_RECENT = 8;
const STORAGE_KEY = "castle:recent-searches";

// ============================================================================
// LocalStorage helpers
// ============================================================================

function loadRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecentSearches(searches: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  } catch {
    // Silent — localStorage might be full or unavailable
  }
}

// ============================================================================
// Hook
// ============================================================================

export function useSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecentSearches);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

          // Save to recent if results found
          if (searchResults.length > 0) {
            setRecentSearches((prev) => {
              const trimmed = q.trim();
              const filtered = prev.filter((s) => s !== trimmed);
              const next = [trimmed, ...filtered].slice(0, MAX_RECENT);
              saveRecentSearches(next);
              return next;
            });
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setResults([]);
        }
      } finally {
        setIsSearching(false);
      }
    }, DEBOUNCE_MS);
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    saveRecentSearches([]);
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
