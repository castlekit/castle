"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Brain, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/lib/types/chat";

interface SessionStatsPanelProps {
  stats: SessionStatus | null;
  isLoading?: boolean;
  className?: string;
}

/** Simple relative time helper — avoids adding date-fns dependency */
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Get context bar color based on usage percentage */
function getContextColor(percentage: number): string {
  if (percentage >= 90) return "bg-error";
  if (percentage >= 80) return "bg-orange-500";
  if (percentage >= 60) return "bg-yellow-500";
  return "bg-success";
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function SessionStatsPanel({ stats, isLoading, className }: SessionStatsPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!stats && !isLoading) return null;

  const percentage = stats?.context?.percentage ?? 0;
  const contextColor = getContextColor(percentage);

  return (
    <div className={cn("border-b border-border", className)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2 flex items-center justify-between text-xs text-foreground-secondary hover:bg-surface-hover/50 transition-colors"
      >
        {/* Collapsed view */}
        {stats ? (
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex items-center gap-1">
              <span className={cn("w-2 h-2 rounded-full", contextColor)} />
              Context: {formatTokens(stats.context.used)}/{formatTokens(stats.context.limit)} ({percentage}%)
            </span>
            <span className="text-foreground-secondary/60">|</span>
            <span>
              Tokens: {formatTokens(stats.tokens.input)} in / {formatTokens(stats.tokens.output)} out
            </span>
          </div>
        ) : (
          <span className="text-foreground-secondary/60">
            {isLoading ? "Loading session stats..." : "No session data"}
          </span>
        )}
        {expanded ? (
          <ChevronUp className="h-3 w-3 shrink-0 ml-2" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 ml-2" />
        )}
      </button>

      {/* Expanded view */}
      {expanded && stats && (
        <div className="px-4 pb-3 space-y-3">
          {/* Context progress bar */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-foreground-secondary">Context Window</span>
              <span className="font-mono">
                {formatTokens(stats.context.used)} / {formatTokens(stats.context.limit)}
              </span>
            </div>
            <div className="w-full h-2 bg-surface-hover rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-300", contextColor)}
                style={{ width: `${Math.min(percentage, 100)}%` }}
              />
            </div>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-foreground-secondary">Model</span>
              <span className="font-medium truncate">{stats.model}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-foreground-secondary">Runtime</span>
              <span className="font-medium">{stats.runtime}</span>
            </div>
            <div className="flex items-center gap-2">
              <Brain className="h-3 w-3 text-foreground-secondary" />
              <span className="text-foreground-secondary">Thinking</span>
              <span className="font-medium">{stats.thinking || "off"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="h-3 w-3 text-foreground-secondary" />
              <span className="text-foreground-secondary">Compactions</span>
              <span className="font-medium">{stats.compactions}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-foreground-secondary">Input tokens</span>
              <span className="font-medium">{stats.tokens.input.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-foreground-secondary">Output tokens</span>
              <span className="font-medium">{stats.tokens.output.toLocaleString()}</span>
            </div>
          </div>

          {/* Updated timestamp */}
          {stats.updatedAt && (
            <div className="text-xs text-foreground-secondary/60 text-right">
              Updated {timeAgo(stats.updatedAt)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
