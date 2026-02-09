"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Search, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSearch } from "@/lib/hooks/use-search";
import type {
  SearchResult,
  SearchResultType,
  MessageSearchResult,
} from "@/lib/types/search";

// ============================================================================
// Result renderers — one per content type (pluggable registry)
// ============================================================================

function MessageResultRow({ result }: { result: MessageSearchResult }) {
  const timeStr = new Date(result.timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="flex items-start gap-3 min-w-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-foreground-secondary mb-0.5">
          <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium text-[11px]">
            {result.title}
          </span>
          {result.archived && (
            <span className="text-[11px] text-foreground-secondary/50 italic">archived</span>
          )}
          <span className="font-medium">{result.subtitle}</span>
          <span className="text-foreground-secondary/60">{timeStr}</span>
        </div>
        <p className="text-sm text-foreground truncate">{result.snippet}</p>
      </div>
    </div>
  );
}

// Registry: map each SearchResultType to its renderer
const resultRenderers: Record<
  SearchResultType,
  ((result: SearchResult) => ReactNode) | null
> = {
  message: (r) => <MessageResultRow result={r as MessageSearchResult} />,
  task: null,    // Future
  note: null,    // Future
  project: null, // Future
};

// ============================================================================
// SearchDialog
// ============================================================================

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SearchDialog({ open, onClose }: SearchDialogProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { query, setQuery, results, isSearching, recentSearches, clearRecentSearches } =
    useSearch();
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Focus input on open
  useEffect(() => {
    if (open) {
      // Small delay to ensure the DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus());
      setSelectedIndex(-1);
    }
  }, [open]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [results, query]);

  // Determine what items are shown (results or recent searches)
  const showRecent = !query.trim() && recentSearches.length > 0;
  const itemCount = showRecent ? recentSearches.length : results.length;

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < itemCount - 1 ? prev + 1 : 0));
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : itemCount - 1));
      return;
    }

    if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      if (showRecent) {
        // Fill input with the recent search
        setQuery(recentSearches[selectedIndex]);
      } else if (results[selectedIndex]) {
        navigateToResult(results[selectedIndex]);
      }
      return;
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-search-item]");
    items[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const navigateToResult = (result: SearchResult) => {
    router.push(result.href);
    // Close after navigation is dispatched — ensures router.push isn't
    // interrupted by the dialog unmounting
    setTimeout(onClose, 0);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="relative w-full max-w-[560px] rounded-[var(--radius-md)] bg-surface border border-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-5 w-5 text-foreground-secondary shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across all channels..."
            className="flex-1 bg-transparent text-[15px] focus:outline-none placeholder:text-foreground-secondary/50"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] font-medium text-foreground-secondary/60 bg-surface-hover rounded border border-border/50">
            ESC
          </kbd>
        </div>

        {/* Results / Recent searches */}
        <div ref={listRef} className="max-h-[400px] overflow-y-auto">
          {/* Recent searches (before typing) */}
          {showRecent && (
            <div>
              <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
                <span className="text-xs font-medium text-foreground-secondary/60 uppercase tracking-wider">
                  Recent searches
                </span>
                <button
                  onClick={clearRecentSearches}
                  className="text-xs text-foreground-secondary/60 hover:text-foreground-secondary transition-colors cursor-pointer"
                >
                  Clear
                </button>
              </div>
              {recentSearches.map((recent, i) => (
                <button
                  key={recent}
                  data-search-item
                  onClick={() => setQuery(recent)}
                  className={cn(
                    "flex items-center gap-3 w-full px-4 py-2.5 text-sm text-left transition-colors cursor-pointer",
                    selectedIndex === i
                      ? "bg-accent/10 text-accent"
                      : "text-foreground hover:bg-surface-hover"
                  )}
                >
                  <Clock className="h-4 w-4 text-foreground-secondary/60 shrink-0" />
                  <span className="truncate">{recent}</span>
                </button>
              ))}
            </div>
          )}

          {/* Empty state — no query, no recent */}
          {!query.trim() && recentSearches.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-foreground-secondary/60">
              Search across all channels
            </div>
          )}

          {/* Loading skeleton */}
          {query.trim() && isSearching && results.length === 0 && (
            <div className="px-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="px-2 py-3 border-b border-border/20 last:border-b-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="skeleton h-4 w-16 rounded" />
                    <div className="skeleton h-3 w-12 rounded" />
                    <div className="skeleton h-3 w-10 rounded" />
                  </div>
                  <div className="skeleton h-3.5 rounded" style={{ width: `${55 + i * 8}%` }} />
                </div>
              ))}
            </div>
          )}

          {/* Results */}
          {query.trim() && !isSearching && results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-foreground-secondary">
              No results found
            </div>
          )}

          {query.trim() &&
            results.map((result, i) => {
              const renderer = resultRenderers[result.type];
              if (!renderer) return null;
              return (
                <button
                  key={result.id}
                  data-search-item
                  onClick={() => navigateToResult(result)}
                  className={cn(
                    "w-full px-4 py-3 text-left transition-colors cursor-pointer border-b border-border/20 last:border-b-0",
                    selectedIndex === i
                      ? "bg-accent/10"
                      : "hover:bg-surface-hover"
                  )}
                >
                  {renderer(result)}
                </button>
              );
            })}
        </div>

        {/* Footer hint */}
        {query.trim() && results.length > 0 && (
          <div className="px-4 py-2 border-t border-border/50 text-[11px] text-foreground-secondary/50 flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 rounded bg-surface-hover border border-border/50 text-[10px]">↑↓</kbd> Navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-surface-hover border border-border/50 text-[10px]">↵</kbd> Open
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-surface-hover border border-border/50 text-[10px]">esc</kbd> Close
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
