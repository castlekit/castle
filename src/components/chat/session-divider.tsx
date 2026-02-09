"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date-utils";
import type { ChannelSession } from "@/lib/types/chat";

interface SessionDividerProps {
  session: ChannelSession;
  className?: string;
}

export function SessionDivider({ session, className }: SessionDividerProps) {
  const [expanded, setExpanded] = useState(false);

  const endedDate = session.endedAt
    ? formatDateTime(session.endedAt)
    : "Ongoing";

  return (
    <div className={cn("relative py-4", className)}>
      {/* Divider line */}
      <div className="absolute inset-x-0 top-1/2 h-px bg-border" />

      {/* Content */}
      <div className="relative flex items-center justify-center">
        <div className="bg-surface px-4 py-2 rounded-full border border-border">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-xs text-foreground-secondary hover:text-foreground transition-colors"
          >
            <span>Session ended {endedDate}</span>
            {session.summary && (
              expanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )
            )}
          </button>
        </div>
      </div>

      {/* Expanded summary */}
      {expanded && session.summary && (
        <div className="mt-3 mx-auto max-w-xl p-4 rounded-xl bg-surface-hover border border-border">
          <p className="text-sm text-foreground-secondary leading-relaxed">
            <span className="font-medium text-foreground">Summary:</span>{" "}
            {session.summary}
          </p>
          <div className="mt-2 flex items-center gap-4 text-xs text-foreground-secondary/60">
            <span>
              {session.totalInputTokens.toLocaleString()} in / {session.totalOutputTokens.toLocaleString()} out
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
