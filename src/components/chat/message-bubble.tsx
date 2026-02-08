"use client";

import React from "react";
import { Bot, User, AlertTriangle, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownContent } from "./markdown-content";
import type { ChatMessage } from "@/lib/types/chat";
import type { AgentInfo } from "./agent-mention-popup";

interface MessageBubbleProps {
  message: ChatMessage;
  isAgent: boolean;
  agentName?: string;
  agentAvatar?: string | null;
  userAvatar?: string | null;
  agents: AgentInfo[];
  isStreaming?: boolean;
}

export function MessageBubble({
  message,
  isAgent,
  agentName,
  agentAvatar,
  userAvatar,
  agents,
  isStreaming,
}: MessageBubbleProps) {
  const formattedTime = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const getAgentDisplayName = () => {
    if (agentName) return agentName;
    if (message.senderName) return `${message.senderName} (Removed)`;
    return "Unknown Agent";
  };

  const hasAttachments = message.attachments && message.attachments.length > 0;

  return (
    <div
      className={cn(
        "flex gap-3 max-w-[85%]",
        isAgent ? "mr-auto" : "ml-auto flex-row-reverse"
      )}
    >
      {/* Avatar */}
      {isAgent && agentAvatar ? (
        <img
          src={agentAvatar}
          alt={agentName || "Agent"}
          className="w-8 h-8 rounded-full shrink-0 object-cover"
        />
      ) : !isAgent && userAvatar ? (
        <img
          src={userAvatar}
          alt="You"
          className="w-8 h-8 rounded-full shrink-0 object-cover"
        />
      ) : (
        <div
          className={cn(
            "flex items-center justify-center w-8 h-8 rounded-full shrink-0",
            isAgent ? "bg-accent/20 text-accent" : "bg-foreground/10 text-foreground"
          )}
        >
          {isAgent ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
        </div>
      )}

      {/* Message content */}
      <div className="flex flex-col gap-1 min-w-0">
        {/* Header */}
        <div
          className={cn(
            "flex items-center gap-2 text-xs text-foreground-secondary",
            !isAgent && "flex-row-reverse"
          )}
        >
          <span className="font-medium">
            {isAgent ? getAgentDisplayName() : "You"}
          </span>
          <span>{formattedTime}</span>
        </div>

        {/* Attachments */}
        {hasAttachments && (
          <div className="flex gap-2 flex-wrap mb-1">
            {message.attachments.map((att) => (
              <img
                key={att.id}
                src={`/api/openclaw/chat/attachments?path=${encodeURIComponent(att.filePath)}`}
                alt={att.originalName || "Attachment"}
                className="max-w-[200px] max-h-[200px] rounded-lg object-cover border border-border"
              />
            ))}
          </div>
        )}

        {/* Bubble */}
        <div
          className={cn(
            "rounded-2xl text-sm",
            isAgent
              ? "bg-surface-hover text-foreground rounded-tl-md"
              : "bg-accent text-accent-foreground rounded-tr-md",
            // Only use padding for non-agent or short messages without markdown
            isAgent && message.content.length > 0
              ? "px-4 py-2.5"
              : "px-4 py-2.5"
          )}
        >
          {isAgent && message.content ? (
            <MarkdownContent content={message.content} />
          ) : (
            <span className="whitespace-pre-wrap">{message.content}</span>
          )}

          {/* Streaming cursor */}
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>

        {/* Status badges */}
        {message.status === "interrupted" && (
          <div className="flex items-center gap-1 text-xs text-warning">
            <AlertTriangle className="h-3 w-3" />
            <span>Response interrupted</span>
          </div>
        )}
        {message.status === "aborted" && (
          <div className="flex items-center gap-1 text-xs text-foreground-secondary">
            <StopCircle className="h-3 w-3" />
            <span>Response stopped</span>
          </div>
        )}

        {/* Token info for agent messages */}
        {isAgent && !isStreaming && (message.inputTokens || message.outputTokens) && (
          <div className="text-xs text-foreground-secondary/60 flex items-center gap-2">
            {message.inputTokens != null && <span>{message.inputTokens.toLocaleString()} in</span>}
            {message.outputTokens != null && <span>{message.outputTokens.toLocaleString()} out</span>}
          </div>
        )}
      </div>
    </div>
  );
}
