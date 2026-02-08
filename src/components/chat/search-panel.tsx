"use client";

import { Search, X, Loader2, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types/chat";
import { useRouter } from "next/navigation";

interface SearchPanelProps {
  query: string;
  onQueryChange: (q: string) => void;
  results: ChatMessage[];
  isSearching: boolean;
  onClose: () => void;
  className?: string;
}

export function SearchPanel({
  query,
  onQueryChange,
  results,
  isSearching,
  onClose,
  className,
}: SearchPanelProps) {
  const router = useRouter();
  return (
    <div className={cn("border-b border-border", className)}>
      {/* Search input */}
      <div className="flex items-center gap-2 px-4 py-2">
        <Search className="h-4 w-4 text-foreground-secondary shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search messages..."
          className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-foreground-secondary/50"
          autoFocus
        />
        {isSearching && (
          <Loader2 className="h-4 w-4 text-foreground-secondary animate-spin shrink-0" />
        )}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-hover transition-colors"
        >
          <X className="h-4 w-4 text-foreground-secondary" />
        </button>
      </div>

      {/* Results */}
      {query.trim() && (
        <div className="max-h-[300px] overflow-y-auto border-t border-border/50">
          {results.length === 0 && !isSearching && (
            <div className="px-4 py-6 text-center text-sm text-foreground-secondary">
              No messages found
            </div>
          )}

          {results.map((msg) => (
            <button
              key={msg.id}
              onClick={() => { onClose(); router.push(`/chat/${msg.channelId}`); }}
              className="flex items-start gap-3 px-4 py-3 hover:bg-surface-hover transition-colors border-b border-border/30 last:border-b-0 w-full text-left cursor-pointer"
            >
              <MessageCircle className="h-4 w-4 text-foreground-secondary shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-foreground-secondary mb-1">
                  <span className="font-medium">
                    {msg.senderType === "user" ? "You" : msg.senderName || msg.senderId}
                  </span>
                  <span>
                    {new Date(msg.createdAt).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <p className="text-sm text-foreground truncate">{msg.content}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
