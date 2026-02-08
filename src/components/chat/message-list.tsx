"use client";

import { useEffect, useRef, useCallback } from "react";
import { Bot, Loader2 } from "lucide-react";
import { MessageBubble } from "./message-bubble";
import { SessionDivider } from "./session-divider";
import type { ChatMessage, ChannelSession, StreamingMessage } from "@/lib/types/chat";
import type { AgentInfo } from "./agent-mention-popup";

interface MessageListProps {
  messages: ChatMessage[];
  sessions?: ChannelSession[];
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  agents: AgentInfo[];
  userAvatar?: string | null;
  streamingMessages?: Map<string, StreamingMessage>;
  onLoadMore?: () => void;
}

export function MessageList({
  messages,
  sessions = [],
  loading,
  loadingMore,
  hasMore,
  agents,
  userAvatar,
  streamingMessages,
  onLoadMore,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isInitialLoad = useRef(true);

  // Auto-scroll to bottom when messages load or new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({
        behavior: isInitialLoad.current ? "instant" : "smooth",
      });
      isInitialLoad.current = false;
    }
  }, [messages.length]);

  // Also scroll when streaming content updates
  useEffect(() => {
    if (streamingMessages && streamingMessages.size > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamingMessages]);

  // Infinite scroll up for loading older messages
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || !hasMore || loadingMore || !onLoadMore) return;
    const { scrollTop } = scrollContainerRef.current;
    if (scrollTop < 100) {
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore]);

  const getAgentName = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    return agent?.name;
  };

  const getAgentAvatar = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    return agent?.avatar;
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-foreground-secondary" />
      </div>
    );
  }

  if (messages.length === 0 && (!streamingMessages || streamingMessages.size === 0)) {
    return (
      <div className="flex-1 flex items-center justify-center text-foreground-secondary">
        <p className="text-sm">No messages yet. Start the conversation!</p>
      </div>
    );
  }

  // Format a date label like Slack does
  const formatDateLabel = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const isToday = date.toDateString() === now.toDateString();
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) return "Today";
    if (isYesterday) return "Yesterday";

    return date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  };

  // Get the date string (YYYY-MM-DD) for grouping
  const getDateKey = (timestamp: number): string =>
    new Date(timestamp).toDateString();

  // Group messages and insert date + session dividers
  type GroupItem =
    | ChatMessage
    | { type: "date"; label: string; key: string }
    | { type: "divider"; session: ChannelSession };

  const groupedContent: GroupItem[] = [];
  let currentDateKey: string | null = null;
  let currentSessionId: string | null = null;

  const sortedSessions = [...sessions].sort((a, b) => a.startedAt - b.startedAt);

  // Count distinct days in the message set
  const distinctDays = new Set(messages.map((m) => getDateKey(m.createdAt)));
  const showDateSeparators = distinctDays.size > 1 || messages.length > 50;

  for (const message of messages) {
    // Insert date separator when the day changes (skip if only one day and ≤50 messages)
    const dateKey = getDateKey(message.createdAt);
    if (showDateSeparators && dateKey !== currentDateKey) {
      groupedContent.push({
        type: "date",
        label: formatDateLabel(message.createdAt),
        key: dateKey,
      });
      currentDateKey = dateKey;
    }

    // Insert session divider when session changes
    if (message.sessionId && message.sessionId !== currentSessionId) {
      if (currentSessionId) {
        const endedSession = sortedSessions.find(
          (s) => s.id === currentSessionId && s.endedAt
        );
        if (endedSession) {
          groupedContent.push({ type: "divider", session: endedSession });
        }
      }
      currentSessionId = message.sessionId;
    }
    groupedContent.push(message);
  }

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto"
      onScroll={handleScroll}
    >
      <div className="py-4 space-y-4">
        {/* Loading more indicator */}
        {loadingMore && (
          <div className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-foreground-secondary" />
          </div>
        )}

        {hasMore && !loadingMore && (
          <div className="flex justify-center py-2">
            <button
              onClick={onLoadMore}
              className="text-xs text-foreground-secondary hover:text-foreground transition-colors"
            >
              Load older messages
            </button>
          </div>
        )}

        {groupedContent.map((item) => {
          if ("type" in item) {
            if (item.type === "date") {
              return (
                <div
                  key={`date-${item.key}`}
                  className="flex items-center gap-3 py-1"
                >
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs font-medium text-foreground-secondary shrink-0">
                    {item.label}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              );
            }
            if (item.type === "divider") {
              return (
                <SessionDivider
                  key={`divider-${item.session.id}`}
                  session={item.session}
                />
              );
            }
          }

          const message = item as ChatMessage;
          const agent = message.senderType === "agent"
            ? agents.find((a) => a.id === message.senderId)
            : undefined;

          return (
            <MessageBubble
              key={message.id}
              message={message}
              isAgent={message.senderType === "agent"}
              agentName={agent?.name || getAgentName(message.senderId)}
              agentAvatar={agent?.avatar || getAgentAvatar(message.senderId)}
              userAvatar={userAvatar}
              agents={agents}
            />
          );
        })}

        {/* Streaming messages (only show if they have content AND aren't already persisted) */}
        {streamingMessages &&
          Array.from(streamingMessages.values())
            .filter((sm) => {
              // Don't render if content is empty (typing indicator handles that)
              if (sm.content.length === 0) return false;
              // Don't render if already persisted in the messages list (prevents duplicate flash)
              if (messages.some((m) => m.runId === sm.runId)) return false;
              return true;
            })
            .map((sm) => (
              <MessageBubble
                key={`streaming-${sm.runId}`}
                message={{
                  id: `streaming-${sm.runId}`,
                  channelId: "",
                  sessionId: null,
                  senderType: "agent",
                  senderId: sm.agentId,
                  senderName: sm.agentName,
                  content: sm.content,
                  status: "complete",
                  mentionedAgentId: null,
                  runId: sm.runId,
                  sessionKey: sm.sessionKey,
                  inputTokens: null,
                  outputTokens: null,
                  createdAt: sm.startedAt,
                  attachments: [],
                  reactions: [],
                }}
                isAgent
                agentName={sm.agentName || getAgentName(sm.agentId)}
                agentAvatar={getAgentAvatar(sm.agentId)}
                agents={agents}
                isStreaming
              />
            ))}

        {/* Typing indicator when there are streaming messages with no content yet */}
        {streamingMessages &&
          Array.from(streamingMessages.values())
            .filter((sm) => sm.content.length === 0)
            .map((sm) => {
              const avatar = getAgentAvatar(sm.agentId);
              return (
                <div
                  key={`typing-${sm.runId}`}
                  className="flex gap-3 max-w-[85%] mr-auto"
                >
                  {avatar ? (
                    <img
                      src={avatar}
                      alt={sm.agentName || getAgentName(sm.agentId) || "Agent"}
                      className="w-8 h-8 rounded-full shrink-0 object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 bg-accent/20 text-accent">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-xs text-foreground-secondary">
                      <span className="font-medium">
                        {sm.agentName || getAgentName(sm.agentId)}
                      </span>
                    </div>
                    <div className="px-4 py-2.5 rounded-2xl rounded-tl-md bg-surface-hover text-foreground">
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 bg-foreground-secondary/60 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-2 h-2 bg-foreground-secondary/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-2 h-2 bg-foreground-secondary/60 rounded-full animate-bounce" />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
