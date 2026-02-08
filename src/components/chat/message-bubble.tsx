"use client";

import React from "react";
import { Bot, User, AlertTriangle, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { MarkdownContent } from "./markdown-content";
import { TwemojiText } from "@/components/ui/twemoji-text";
import type { ChatMessage } from "@/lib/types/chat";
import type { AgentInfo } from "./agent-mention-popup";
import type { AgentStatus } from "@/lib/hooks/use-agent-status";

interface MessageBubbleProps {
  message: ChatMessage;
  isAgent: boolean;
  agentName?: string;
  agentAvatar?: string | null;
  userAvatar?: string | null;
  agents: AgentInfo[];
  isStreaming?: boolean;
  /** Whether to show avatar and name (false for consecutive messages from same sender) */
  showHeader?: boolean;
  agentStatus?: AgentStatus;
  userStatus?: AgentStatus;
}

export function MessageBubble({
  message,
  isAgent,
  agentName,
  agentAvatar,
  userAvatar,
  agents,
  isStreaming,
  showHeader = true,
  agentStatus,
  userStatus,
}: MessageBubbleProps) {
  const formattedTime = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const getAgentDisplayName = () => {
    if (agentName) return agentName;
    if (message.senderName) return `${message.senderName} (Removed)`;
    return "Unknown Agent";
  };

  const displayName = isAgent ? getAgentDisplayName() : "You";
  const avatarSrc = isAgent ? agentAvatar : userAvatar;
  const hasAttachments = message.attachments && message.attachments.length > 0;

  // Map status to Avatar status prop
  const avatarStatus = isAgent && agentStatus
    ? ({ thinking: "away", active: "online", idle: "offline" } as const)[agentStatus]
    : !isAgent && userStatus
    ? ({ active: "online", idle: "offline", thinking: "away" } as const)[userStatus]
    : undefined;

  return (
    <div className={cn("flex gap-3", showHeader ? "mt-4 first:mt-0" : "mt-0.5 pl-[48px]")}>
      {/* Avatar — only shown on first message in a group */}
      {showHeader && (
        <div className="mt-0.5">
          <Avatar size="sm" status={avatarStatus} statusPulse={agentStatus === "thinking"}>
            {avatarSrc ? (
              <AvatarImage src={avatarSrc} alt={displayName} />
            ) : (
              <AvatarFallback
                className={cn(
                  isAgent ? "bg-accent/20 text-accent" : "bg-foreground/10 text-foreground"
                )}
              >
                {isAgent ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </AvatarFallback>
            )}
          </Avatar>
        </div>
      )}

      {/* Message content */}
      <div className="flex flex-col min-w-0">
        {/* Name + time header — only on first message in a group */}
        {showHeader && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="font-bold text-[15px] text-foreground">
              {displayName}
            </span>
            <span className="text-xs text-foreground-secondary">
              {formattedTime}
            </span>
          </div>
        )}

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

        {/* Message text — no bubble, just plain text */}
        <div className="text-[15px] text-foreground leading-[26px] break-all">
          <TwemojiText>
            {isAgent && message.content ? (
              <MarkdownContent content={message.content} />
            ) : (
              <span className="whitespace-pre-wrap">{message.content}</span>
            )}
          </TwemojiText>

          {/* Streaming cursor */}
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>

        {/* Status badges */}
        {message.status === "interrupted" && (
          <div className="flex items-center gap-1 text-xs text-warning mt-1">
            <AlertTriangle className="h-3 w-3" />
            <span>Response interrupted</span>
          </div>
        )}
        {message.status === "aborted" && (
          <div className="flex items-center gap-1 text-xs text-foreground-secondary mt-1">
            <StopCircle className="h-3 w-3" />
            <span>Response stopped</span>
          </div>
        )}

        {/* Token info for agent messages */}
        {isAgent && !isStreaming && (message.inputTokens || message.outputTokens) && (
          <div className="text-xs text-foreground-secondary/60 flex items-center gap-2 mt-1">
            {message.inputTokens != null && <span>{message.inputTokens.toLocaleString()} in</span>}
            {message.outputTokens != null && <span>{message.outputTokens.toLocaleString()} out</span>}
          </div>
        )}
      </div>
    </div>
  );
}
