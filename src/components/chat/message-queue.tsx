"use client";

import { X, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MessageQueueProps {
  messages: string[];
  onRemove: (index: number) => void;
  onSendAll: () => void;
  sending?: boolean;
  className?: string;
}

export function MessageQueue({ messages, onRemove, onSendAll, sending, className }: MessageQueueProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground-secondary">
          Queued ({messages.length})
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={onSendAll}
          disabled={sending}
          className="h-7"
        >
          {sending ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send className="h-3 w-3 mr-1" />
              Send All
            </>
          )}
        </Button>
      </div>

      {/* Queued messages */}
      <div className="space-y-2">
        {messages.map((message, index) => (
          <div
            key={index}
            className="relative p-3 rounded-xl border border-dashed border-border bg-surface-hover/50"
          >
            <button
              onClick={() => onRemove(index)}
              className="absolute top-2 right-2 p-1 rounded-full hover:bg-surface-hover text-foreground-secondary hover:text-foreground"
              disabled={sending}
            >
              <X className="h-3 w-3" />
            </button>
            <p className="text-sm pr-6 line-clamp-2">{message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
