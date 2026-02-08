"use client";

import { useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { Bot, CalendarDays, Loader2, MessageSquare } from "lucide-react";
import { MessageBubble } from "./message-bubble";
import { SessionDivider } from "./session-divider";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useAgentStatus, USER_STATUS_ID } from "@/lib/hooks/use-agent-status";
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
  channelName?: string | null;
  channelCreatedAt?: number | null;
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
  channelName,
  channelCreatedAt,
}: MessageListProps) {
  const { getStatus: getAgentStatus } = useAgentStatus();
  const userStatus = getAgentStatus(USER_STATUS_ID);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isInitialLoad = useRef(true);
  const pinnedToBottom = useRef(true);
  const isLoadingOlder = useRef(false);

  // Scroll helper
  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  // Track if user has scrolled away from bottom
  const checkIfPinned = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const threshold = 50;
    pinnedToBottom.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  // ResizeObserver: auto-scroll when content OR container size changes while pinned.
  // The container can resize when the input box below shrinks (e.g. text cleared on send).
  // When that happens the browser caps scrollTop and content appears to shift down.
  useEffect(() => {
    const content = contentRef.current;
    const container = scrollContainerRef.current;
    if (!content || !container) return;

    const observer = new ResizeObserver(() => {
      if (pinnedToBottom.current) {
        scrollToBottom();
      }
    });
    observer.observe(content);
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  // Initial scroll before paint
  useLayoutEffect(() => {
    if (isInitialLoad.current && messages.length > 0) {
      pinnedToBottom.current = true;
      scrollToBottom();
      requestAnimationFrame(scrollToBottom);
      isInitialLoad.current = false;
    }
  }, [messages.length, scrollToBottom]);

  // Re-pin to bottom when new messages arrive or streaming changes,
  // but NOT when loading older messages via infinite scroll.
  useLayoutEffect(() => {
    if (!isInitialLoad.current) {
      if (isLoadingOlder.current) {
        isLoadingOlder.current = false;
      } else {
        pinnedToBottom.current = true;
      }
    }
  }, [messages, streamingMessages]);

  // EVERY render: if pinned, scroll to bottom BEFORE paint.
  // This catches container resizes (e.g. input box shrinks when cleared)
  // that would otherwise cause a one-frame content shift.
  useLayoutEffect(() => {
    if (pinnedToBottom.current) {
      scrollToBottom();
    }
  });

  // Infinite scroll up for loading older messages + track pinned state
  const handleScroll = useCallback(() => {
    checkIfPinned();
    if (!scrollContainerRef.current || !hasMore || loadingMore || !onLoadMore) return;
    const { scrollTop } = scrollContainerRef.current;
    if (scrollTop < 100) {
      isLoadingOlder.current = true;
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore, checkIfPinned]);

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
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center">
          <MessageSquare className="h-9 w-9 text-foreground-secondary/40 mb-3" />
          <span className="text-sm font-medium text-foreground-secondary">No messages yet</span>
          <span className="text-xs text-foreground-secondary/60 mt-1">Start the conversation</span>
        </div>
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

  for (const message of messages) {
    // Insert date separator when the day changes
    const dateKey = getDateKey(message.createdAt);
    if (dateKey !== currentDateKey) {
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
      <div ref={contentRef} className="py-[20px] pr-[20px]">
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

        {/* Channel origin marker — shown when all history is loaded */}
        {!hasMore && channelCreatedAt && (
          <div className="flex flex-col items-center py-8 mb-2">
            <CalendarDays className="h-9 w-9 text-foreground-secondary/40 mb-3" />
            <span className="text-sm font-medium text-foreground-secondary">
              Channel created on {new Date(channelCreatedAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
            </span>
            <span className="text-xs text-foreground-secondary/60 mt-1">
              This is the very beginning of the conversation
            </span>
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
              agentStatus={message.senderType === "agent" ? getAgentStatus(message.senderId) : undefined}
              userStatus={message.senderType === "user" ? userStatus : undefined}
            />
          );
        })}

        {/* Typing indicator — shows dots until the final message is persisted */}
        {streamingMessages &&
          Array.from(streamingMessages.values())
            .filter((sm) => !messages.some((m) => m.runId === sm.runId && m.senderType === "agent"))
            .map((sm) => {
              const avatarSrc = getAgentAvatar(sm.agentId);
              const name = sm.agentName || getAgentName(sm.agentId);
              const status = getAgentStatus(sm.agentId);
              const avatarStatus = ({ thinking: "away", active: "online", idle: "offline" } as const)[status];
              return (
                <div
                  key={`streaming-${sm.runId}`}
                  className="flex gap-3 mt-4"
                >
                  <div className="mt-0.5">
                    <Avatar size="sm" status={avatarStatus} statusPulse={status === "thinking"}>
                      {avatarSrc ? (
                        <AvatarImage src={avatarSrc} alt={name || "Agent"} />
                      ) : (
                        <AvatarFallback className="bg-accent/20 text-accent">
                          <Bot className="w-4 h-4" />
                        </AvatarFallback>
                      )}
                    </Avatar>
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2 mb-0.5">
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
