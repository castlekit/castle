"use client";

import { useEffect, useLayoutEffect, useRef, useCallback } from "react";
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

  // Initial scroll: useLayoutEffect runs BEFORE paint so user never sees the jump
  useLayoutEffect(() => {
    if (isInitialLoad.current && messages.length > 0) {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
      isInitialLoad.current = false;
    }
  }, [messages.length]);

  // Subsequent messages: smooth scroll after paint
  useEffect(() => {
    if (!isInitialLoad.current && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
        <Loader2 className="h-5 w-5 animate-spin text-foreground-secondary" />
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
      className="flex-1 overflow-y-auto flex flex-col justify-end"
      onScroll={handleScroll}
    >
      <div className="py-[20px] pr-[20px]">
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

        {groupedContent.map((item, index) => {
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

          // Check if previous item was a message from the same sender (for grouping)
          const prevItem = index > 0 ? groupedContent[index - 1] : null;
          const prevMessage = prevItem && !("type" in prevItem) ? prevItem as ChatMessage : null;
          const isSameSender = prevMessage
            && prevMessage.senderType === message.senderType
            && prevMessage.senderId === message.senderId;

          return (
            <MessageBubble
              key={message.id}
              message={message}
              isAgent={message.senderType === "agent"}
              agentName={agent?.name || getAgentName(message.senderId)}
              agentAvatar={agent?.avatar || getAgentAvatar(message.senderId)}
              userAvatar={userAvatar}
              agents={agents}
              showHeader={!isSameSender}
            />
          );
        })}

        {/* Typing indicator — shows dots until the final message is persisted */}
        {streamingMessages &&
          Array.from(streamingMessages.values())
            .filter((sm) => !messages.some((m) => m.runId === sm.runId && m.senderType === "agent"))
            .map((sm) => {
              const avatar = getAgentAvatar(sm.agentId);
              const name = sm.agentName || getAgentName(sm.agentId);
              return (
                <div
                  key={`streaming-${sm.runId}`}
                  className="flex gap-3 mt-4"
                >
                  {avatar ? (
                    <img
                      src={avatar}
                      alt={name || "Agent"}
                      className="w-9 h-9 rounded-[4px] shrink-0 object-cover mt-0.5"
                    />
                  ) : (
                    <div className="flex items-center justify-center w-9 h-9 rounded-[4px] shrink-0 bg-accent/20 text-accent mt-0.5">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}
                  <div className="flex flex-col">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="font-bold text-[15px] text-foreground">
                        {name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 py-1">
                      <span className="w-2 h-2 bg-foreground-secondary/60 rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-2 h-2 bg-foreground-secondary/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-2 h-2 bg-foreground-secondary/60 rounded-full animate-bounce" />
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
