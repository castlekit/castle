"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
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
// Reusable search trigger button (flow element — no fixed positioning)
// ============================================================================

export function SearchTrigger({ className }: { className?: string }) {
  const { openSearch } = useSearchContext();
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(navigator.platform?.toUpperCase().includes("MAC") ?? true);
  }, []);

  return (
    <button
      onClick={openSearch}
      className={className ?? "flex items-center gap-3 pl-3 pr-2.5 h-[38px] w-[320px] rounded-[var(--radius-sm)] bg-surface border border-border hover:border-border-hover text-foreground-secondary hover:text-foreground transition-colors cursor-pointer shadow-sm"}
    >
      <Search className="h-4 w-4 shrink-0" strokeWidth={2.5} />
      <span className="text-sm text-foreground-secondary/50 flex-1 text-left">Search Castle...</span>
      <kbd className="flex items-center justify-center h-[22px] px-1.5 gap-1 rounded-[4px] bg-surface-hover border border-border font-medium text-foreground-secondary">
        {isMac ? <span className="text-[15px]">⌘</span> : <span className="text-[11px]">Ctrl</span>}
        <span className="text-[11px]">K</span>
      </kbd>
    </button>
  );
}

// ============================================================================
// Provider
// ============================================================================

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMac, setIsMac] = useState(true);
  const pathname = usePathname();

  // Detect platform for keyboard shortcut display
  useEffect(() => {
    setIsMac(navigator.platform?.toUpperCase().includes("MAC") ?? true);
  }, []);

  // Hide floating trigger on pages that render their own SearchTrigger in the header
  const showFloatingSearch =
    !["/settings", "/ui-kit", "/"].includes(pathname) &&
    !pathname.startsWith("/chat");

  const openSearch = useCallback(() => setIsSearchOpen(true), []);
  const closeSearch = useCallback(() => setIsSearchOpen(false), []);

  // Global shortcut: Cmd+K / Ctrl+K to open search
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
      {/* Floating search trigger — only on pages without an embedded header trigger */}
      {showFloatingSearch && (
        <button
          onClick={openSearch}
          className="fixed top-[28px] right-[28px] z-40 flex items-center gap-3 pl-3 pr-2.5 h-[38px] w-[320px] rounded-[var(--radius-sm)] bg-surface border border-border hover:border-border-hover text-foreground-secondary hover:text-foreground transition-colors cursor-pointer shadow-sm"
        >
          <Search className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          <span className="text-sm text-foreground-secondary/50 flex-1 text-left">Search Castle...</span>
          <kbd className="flex items-center justify-center h-[22px] px-1.5 gap-1 rounded-[4px] bg-surface-hover border border-border font-medium text-foreground-secondary">
            {isMac ? <span className="text-[15px]">⌘</span> : <span className="text-[11px]">Ctrl</span>}
            <span className="text-[11px]">K</span>
          </kbd>
        </button>
      )}
      <SearchDialog open={isSearchOpen} onClose={closeSearch} />
    </SearchContext.Provider>
  );
}
