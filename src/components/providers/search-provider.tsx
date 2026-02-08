"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
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

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <SearchContext.Provider value={{ isSearchOpen, openSearch, closeSearch }}>
      {children}
      <SearchDialog open={isSearchOpen} onClose={closeSearch} />
    </SearchContext.Provider>
  );
}
