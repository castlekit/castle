"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { Search } from "lucide-react";
import { SearchDialog } from "@/components/search/search-dialog";

// ============================================================================
// Context
// ============================================================================

interface SearchContextValue {
  isSearchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
}

const SearchContext = createContext<SearchContextValue>({
  isSearchOpen: false,
  openSearch: () => {},
  closeSearch: () => {},
});

export function useSearchContext() {
  return useContext(SearchContext);
}

// ============================================================================
// Provider
// ============================================================================

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const openSearch = useCallback(() => setIsSearchOpen(true), []);
  const closeSearch = useCallback(() => setIsSearchOpen(false), []);

  // Global shortcuts: Cmd+K / Ctrl+K and "/" to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
        return;
      }
      // "/" opens search unless user is typing in an input/textarea/contenteditable
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        const editable = (e.target as HTMLElement)?.isContentEditable;
        if (tag === "INPUT" || tag === "TEXTAREA" || editable) return;
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <SearchContext.Provider value={{ isSearchOpen, openSearch, closeSearch }}>
      {children}
      {/* Floating search trigger — top right */}
      <button
        onClick={openSearch}
        className="fixed top-[28px] right-[28px] z-50 flex items-center gap-3 pl-3 pr-2.5 h-[38px] w-[320px] rounded-[var(--radius-sm)] bg-surface border border-border hover:border-border-hover text-foreground-secondary hover:text-foreground transition-colors cursor-pointer shadow-sm"
      >
        <Search className="h-4 w-4 shrink-0" strokeWidth={2.5} />
        <span className="text-sm text-foreground-secondary/50 flex-1 text-left">Search Castle...</span>
        <kbd className="flex items-center justify-center h-[22px] min-w-[22px] px-1 rounded-[4px] bg-surface-hover border border-border text-[11px] font-medium text-foreground-secondary">/</kbd>
      </button>
      <SearchDialog open={isSearchOpen} onClose={closeSearch} />
    </SearchContext.Provider>
  );
}
