"use client";

import { useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { Bot, CalendarDays, Loader2, MessageSquare } from "lucide-react";
import { MessageBubble } from "./message-bubble";
import { SessionDivider } from "./session-divider";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useAgentStatus, setAgentActive, getThinkingChannel, USER_STATUS_ID } from "@/lib/hooks/use-agent-status";
import type { ChatMessage, ChannelSession, StreamingMessage } from "@/lib/types/chat";
import type { AgentInfo } from "./agent-mention-popup";

// ---------------------------------------------------------------------------
// Reusable typing indicator (bouncing dots with agent avatar)
// ---------------------------------------------------------------------------

function TypingIndicator({
  agentId,
  agentName,
  agentAvatar,
}: {
  agentId: string;
  agentName?: string;
  agentAvatar?: string | null;
}) {
  const { getStatus } = useAgentStatus();
  const status = getStatus(agentId);
  const avatarStatus = ({ thinking: "away", active: "online", idle: "offline" } as const)[status];

  return (
    <div className="flex gap-3 mt-4">
      <div className="mt-0.5">
        <Avatar size="sm" status={avatarStatus} statusPulse={status === "thinking"}>
          {agentAvatar ? (
            <AvatarImage src={agentAvatar} alt={agentName || "Agent"} />
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
            {agentName || agentId}
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
}

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
  /** Whether there are newer messages to load (anchor mode) */
  hasMoreAfter?: boolean;
  /** Callback to load newer messages (anchor mode) */
  onLoadNewer?: () => void;
  /** Whether newer messages are currently loading */
  loadingNewer?: boolean;
  channelId?: string;
  channelName?: string | null;
  channelCreatedAt?: number | null;
  highlightMessageId?: string;
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
  hasMoreAfter,
  onLoadNewer,
  loadingNewer,
  channelId,
  channelName,
  channelCreatedAt,
  highlightMessageId,
}: MessageListProps) {
  const { statuses: agentStatuses, getStatus: getAgentStatus } = useAgentStatus();
  const userStatus = getAgentStatus(USER_STATUS_ID);

  // Clear stale "thinking" status on mount/update.
  // If the agent finished its response while the user was on another page,
  // the SSE listener was closed so setAgentActive() never fired.
  // Detect this by checking if the "thinking" agent already has a completed
  // message after the last user message, and transition them to "active".
  // IMPORTANT: only check agents that are thinking in THIS channel to avoid
  // clearing a thinking status that belongs to a different channel.
  useEffect(() => {
    if (messages.length === 0) return;
    for (const [agentId, status] of Object.entries(agentStatuses)) {
      if (status !== "thinking" || agentId === USER_STATUS_ID) continue;
      // Only clear if the agent is thinking in this specific channel
      const thinkingIn = getThinkingChannel(agentId);
      if (thinkingIn && thinkingIn !== channelId) continue;
      const lastUserIdx = messages.findLastIndex((m) => m.senderType === "user");
      const lastAgentIdx = messages.findLastIndex(
        (m) => m.senderType === "agent" && m.senderId === agentId
      );
      if (lastAgentIdx > lastUserIdx) {
        // Agent already responded — clear the stale "thinking" status
        setAgentActive(agentId);
      }
    }
  }, [messages, agentStatuses, channelId]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isInitialLoad = useRef(true);
  const pinnedToBottom = useRef(true);
  const isLoadingOlder = useRef(false);
  const highlightHandled = useRef<string | null>(null);

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

  // Initial scroll before paint — skip if we have a highlight target
  useLayoutEffect(() => {
    if (isInitialLoad.current && messages.length > 0) {
      if (!highlightMessageId) {
        pinnedToBottom.current = true;
        scrollToBottom();
        requestAnimationFrame(scrollToBottom);
      }
      isInitialLoad.current = false;
    }
  }, [messages.length, scrollToBottom, highlightMessageId]);

  // Re-pin to bottom when new messages arrive or streaming changes,
  // but NOT when loading older messages via infinite scroll,
  // and NOT when a highlight target is active.
  useLayoutEffect(() => {
    if (!isInitialLoad.current) {
      if (isLoadingOlder.current) {
        isLoadingOlder.current = false;
      } else if (highlightMessageId) {
        // Don't auto-pin while a highlight target is active —
        // let the highlight scroll and user scrolling manage pinning.
      } else {
        pinnedToBottom.current = true;
      }
    }
  }, [messages, streamingMessages, highlightMessageId]);

  // EVERY render: if pinned, scroll to bottom BEFORE paint.
  useLayoutEffect(() => {
    if (pinnedToBottom.current) {
      scrollToBottom();
    }
  });

  // Scroll to highlighted message — MUST be the LAST useLayoutEffect so it
  // runs after all the pinning/scrolling effects above and gets the final say.
  useLayoutEffect(() => {
    if (!highlightMessageId) return;
    if (highlightMessageId === highlightHandled.current) return;
    if (messages.length === 0) return;

    const el = document.getElementById(`msg-${highlightMessageId}`);
    if (el) {
      highlightHandled.current = highlightMessageId;
      pinnedToBottom.current = false;
      el.scrollIntoView({ behavior: "instant", block: "center" });
    }
  }, [highlightMessageId, messages]);

  // Infinite scroll: up for older messages, down for newer messages
  const handleScroll = useCallback(() => {
    checkIfPinned();
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;

    // Load older messages when scrolling near the top
    if (scrollTop < 100 && hasMore && !loadingMore && onLoadMore) {
      isLoadingOlder.current = true;
      onLoadMore();
    }

    // Load newer messages when scrolling near the bottom (anchor mode)
    const scrollBottom = scrollHeight - scrollTop - clientHeight;
    if (scrollBottom < 100 && hasMoreAfter && !loadingNewer && onLoadNewer) {
      onLoadNewer();
    }
  }, [hasMore, loadingMore, onLoadMore, hasMoreAfter, loadingNewer, onLoadNewer, checkIfPinned]);

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
                  className="flex items-center gap-3 py-1 my-[30px]"
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
            <div key={message.id} id={`msg-${message.id}`}>
              <MessageBubble
                message={message}
                isAgent={message.senderType === "agent"}
                agentName={agent?.name || getAgentName(message.senderId)}
                agentAvatar={agent?.avatar || getAgentAvatar(message.senderId)}
                userAvatar={userAvatar}
                agents={agents}
                showHeader={!isSameSender}
                agentStatus={message.senderType === "agent" ? getAgentStatus(message.senderId) : undefined}
                userStatus={message.senderType === "user" ? userStatus : undefined}
                highlighted={highlightMessageId === message.id}
              />
            </div>
          );
        })}

        {/* Loading newer messages indicator (anchor mode) */}
        {loadingNewer && (
          <div className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-foreground-secondary" />
          </div>
        )}

        {hasMoreAfter && !loadingNewer && (
          <div className="flex justify-center py-2">
            <button
              onClick={onLoadNewer}
              className="text-xs text-foreground-secondary hover:text-foreground transition-colors"
            >
              Load newer messages
            </button>
          </div>
        )}

        {/* Typing indicator — shows dots until the final message is persisted */}
        {streamingMessages &&
          Array.from(streamingMessages.values())
            .filter((sm) => !messages.some((m) => m.runId === sm.runId && m.senderType === "agent"))
            .map((sm) => (
              <TypingIndicator
                key={`streaming-${sm.runId}`}
                agentId={sm.agentId}
                agentName={sm.agentName || getAgentName(sm.agentId)}
                agentAvatar={getAgentAvatar(sm.agentId)}
              />
            ))}

        {/* Fallback: show dots for agents in "thinking" state without active streaming.
            This covers the case where the user navigated away and came back —
            streamingMessages is empty but the agent status is still "thinking" in the DB.
            We iterate agentStatuses directly instead of the agents prop because the
            agents list (from useOpenClaw) may still be empty on the first render if
            the gateway connection hasn't been confirmed yet. */}
        {Object.entries(agentStatuses)
          .filter(([agentId, status]) => {
            if (status !== "thinking" || agentId === USER_STATUS_ID) return false;
            // Only show indicator for agents thinking in THIS channel
            const thinkingIn = getThinkingChannel(agentId);
            if (thinkingIn && thinkingIn !== channelId) return false;
            // Skip if already shown via streaming messages above
            if (streamingMessages?.size) {
              const alreadyStreaming = Array.from(streamingMessages.values())
                .some((sm) => sm.agentId === agentId);
              if (alreadyStreaming) return false;
            }
            // Skip if agent already responded after the last user message
            const lastUserIdx = messages.findLastIndex((m) => m.senderType === "user");
            const lastAgentIdx = messages.findLastIndex(
              (m) => m.senderType === "agent" && m.senderId === agentId
            );
            if (lastAgentIdx > lastUserIdx) return false;
            return true;
          })
          .map(([agentId]) => {
            // Try to get display info from the agents prop first, then from messages
            const agentInfo = agents.find((a) => a.id === agentId);
            const fallbackName = agentInfo?.name
              || messages.findLast((m) => m.senderType === "agent" && m.senderId === agentId)?.senderName
              || agentId;
            const fallbackAvatar = agentInfo?.avatar ?? null;
            return (
              <TypingIndicator
                key={`thinking-${agentId}`}
                agentId={agentId}
                agentName={fallbackName}
                agentAvatar={fallbackAvatar}
              />
            );
          })}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
