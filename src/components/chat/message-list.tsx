"use client";

import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import { CalendarDays, ChevronUp, Loader2, MessageSquare, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageBubble } from "./message-bubble";
import { SessionDivider } from "./session-divider";
import { useAgentStatus, setAgentActive, getThinkingChannel, USER_STATUS_ID } from "@/lib/hooks/use-agent-status";
import { formatDate } from "@/lib/date-utils";
import type { ChatMessage, ChannelSession, StreamingMessage } from "@/lib/types/chat";
import type { AgentInfo } from "./agent-mention-popup";

// ---------------------------------------------------------------------------
// Build a lightweight fake ChatMessage for the typing-indicator MessageBubble.
// This avoids a separate component entirely — the indicator IS a MessageBubble.
function makeIndicatorMessage(agentId: string, agentName?: string): ChatMessage {
  return {
    id: `typing-${agentId}`,
    channelId: "",
    sessionId: null,
    senderType: "agent",
    senderId: agentId,
    senderName: agentName || null,
    content: "",
    status: undefined as never,
    mentionedAgentId: null,
    runId: null,
    sessionKey: null,
    inputTokens: null,
    outputTokens: null,
    createdAt: Date.now(),
    attachments: [],
    reactions: [],
  };
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
  /** Ref that will be populated with a navigate-between-messages function */
  navigateRef?: React.MutableRefObject<((direction: "up" | "down") => void) | null>;
  /** ID of the oldest message still in the agent's context (compaction boundary) */
  compactionBoundaryMessageId?: string | null;
  /** Total number of compactions in this session */
  compactionCount?: number;
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
  navigateRef,
  compactionBoundaryMessageId,
  compactionCount,
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
  const prevScrollHeightRef = useRef<number>(0);
  const highlightHandled = useRef<string | null>(null);

  // "Scroll to message start" button — shows when the last agent message
  // extends beyond the viewport so the user can jump to where it began.
  const [showScrollToStart, setShowScrollToStart] = useState(false);
  const lastAgentMsgId = useRef<string | null>(null);
  // Once the user has navigated to a message's start, don't show the button again for it
  const dismissedMsgId = useRef<string | null>(null);

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
        // Restore scroll position after older messages are prepended.
        // The new content pushes everything down, so we adjust scrollTop
        // by the difference in scrollHeight to keep the user at the same spot.
        const container = scrollContainerRef.current;
        if (container && prevScrollHeightRef.current > 0) {
          const newScrollHeight = container.scrollHeight;
          const delta = newScrollHeight - prevScrollHeightRef.current;
          container.scrollTop += delta;
        }
        prevScrollHeightRef.current = 0;
        isLoadingOlder.current = false;
      } else if (highlightMessageId) {
        // Don't auto-pin while a highlight target is active —
        // let the highlight scroll and user scrolling manage pinning.
      } else if (pinnedToBottom.current) {
        // Only re-pin if already pinned (e.g. new incoming message while at bottom).
        // Don't force-pin when user has scrolled away.
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

  // Track the last agent message ID so we can check if its top is in view.
  // On initial load, auto-dismiss so the button only appears for NEW messages.
  useEffect(() => {
    const lastAgent = [...messages].reverse().find((m) => m.senderType === "agent");
    const prevId = lastAgentMsgId.current;
    lastAgentMsgId.current = lastAgent?.id ?? null;

    if (!lastAgent) {
      setShowScrollToStart(false);
    } else if (prevId === null) {
      // First time we see messages (page load) — dismiss the current one
      dismissedMsgId.current = lastAgent.id;
    }
  }, [messages]);

  // Check if the last agent message's top edge is scrolled out of view.
  // Called on every scroll event via handleScroll.
  const checkScrollToStart = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!lastAgentMsgId.current || !container) {
      setShowScrollToStart(false);
      return;
    }
    // Already dismissed for this message — don't show again
    if (dismissedMsgId.current === lastAgentMsgId.current) {
      setShowScrollToStart(false);
      return;
    }
    const el = document.getElementById(`msg-${lastAgentMsgId.current}`);
    if (!el) {
      setShowScrollToStart(false);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    // Show button when the top of the message is above the container's top edge
    // AND the bottom is still visible (user is reading the message)
    const topAboveView = elRect.top < containerRect.top - 10;
    const bottomStillVisible = elRect.bottom > containerRect.top;
    const shouldShow = topAboveView && bottomStillVisible;
    // If user scrolled to the top of the message, dismiss permanently
    if (!topAboveView && dismissedMsgId.current !== lastAgentMsgId.current) {
      dismissedMsgId.current = lastAgentMsgId.current;
    }
    setShowScrollToStart(shouldShow);
  }, []);

  // Infinite scroll: up for older messages, down for newer messages
  const handleScroll = useCallback(() => {
    checkIfPinned();
    checkScrollToStart();
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;

    // Load older messages when scrolling near the top
    if (scrollTop < 200 && hasMore && !loadingMore && onLoadMore) {
      isLoadingOlder.current = true;
      prevScrollHeightRef.current = scrollHeight;
      pinnedToBottom.current = false;
      onLoadMore();
    }

    // Load newer messages when scrolling near the bottom (anchor mode)
    const scrollBottom = scrollHeight - scrollTop - clientHeight;
    if (scrollBottom < 100 && hasMoreAfter && !loadingNewer && onLoadNewer) {
      onLoadNewer();
    }
  }, [hasMore, loadingMore, onLoadMore, hasMoreAfter, loadingNewer, onLoadNewer, checkIfPinned, checkScrollToStart]);

  const getAgentName = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    return agent?.name;
  };

  const getAgentAvatar = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    return agent?.avatar;
  };

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

    return formatDate(timestamp);
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

  // Navigate between messages with Shift+Up/Down (also used by "Start of message" button)
  const navigateToMessage = useCallback(
    (direction: "up" | "down") => {
      const container = scrollContainerRef.current;
      if (!container || messages.length === 0) return;

      const containerRect = container.getBoundingClientRect();
      const threshold = 10; // px tolerance to avoid sticking on current message

      if (direction === "up") {
        // Find the last message whose top is above the current viewport top
        for (let i = messages.length - 1; i >= 0; i--) {
          const el = document.getElementById(`msg-${messages[i].id}`);
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          if (rect.top < containerRect.top - threshold) {
            const offset =
              rect.top - containerRect.top + container.scrollTop - 8;
            container.scrollTo({ top: offset, behavior: "smooth" });
            return;
          }
        }
        // Already at the top — scroll to very top
        container.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        // Find the first message whose top is below the current viewport top
        for (let i = 0; i < messages.length; i++) {
          const el = document.getElementById(`msg-${messages[i].id}`);
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          if (rect.top > containerRect.top + threshold) {
            const offset =
              rect.top - containerRect.top + container.scrollTop - 8;
            container.scrollTo({ top: offset, behavior: "smooth" });
            return;
          }
        }
        // Already at the bottom — scroll to very bottom
        container.scrollTo({
          top: container.scrollHeight,
          behavior: "smooth",
        });
      }
    },
    [messages]
  );

  // Expose navigateToMessage to parent via ref
  useEffect(() => {
    if (navigateRef) {
      navigateRef.current = navigateToMessage;
    }
    return () => {
      if (navigateRef) {
        navigateRef.current = null;
      }
    };
  }, [navigateRef, navigateToMessage]);

  if (!loading && messages.length === 0 && (!streamingMessages || streamingMessages.size === 0)) {
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

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={scrollContainerRef}
        className="h-full overflow-y-auto flex flex-col"
        onScroll={handleScroll}
      >
      <div className="flex-1" />
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
              Channel created on {formatDate(new Date(channelCreatedAt).getTime())}
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

          // Determine if this message is compacted (before the boundary)
          const isCompacted = compactionBoundaryMessageId
            ? message.id !== compactionBoundaryMessageId &&
              messages.indexOf(message) < messages.findIndex((m) => m.id === compactionBoundaryMessageId)
            : false;

          // Show compaction divider just before the boundary message
          const showCompactionDivider = compactionBoundaryMessageId === message.id && (compactionCount ?? 0) > 0;

          return (
            <div key={message.id} id={`msg-${message.id}`}>
              {showCompactionDivider && (
                <div className="flex items-center gap-3 py-1 my-[20px]">
                  <div className="flex-1 h-px bg-yellow-500/30" />
                  <span className="text-[11px] text-yellow-600 dark:text-yellow-400 shrink-0 flex items-center gap-1.5">
                    <Zap className="h-3 w-3" />
                    Context compacted ({compactionCount} time{compactionCount !== 1 ? "s" : ""}) — agent has a summary of messages above
                  </span>
                  <div className="flex-1 h-px bg-yellow-500/30" />
                </div>
              )}
              <div className={cn(isCompacted && "opacity-50")}>
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
              <MessageBubble
                key={`streaming-${sm.runId}`}
                message={makeIndicatorMessage(sm.agentId, sm.agentName || getAgentName(sm.agentId))}
                isAgent
                agentName={sm.agentName || getAgentName(sm.agentId)}
                agentAvatar={getAgentAvatar(sm.agentId)}
                agents={agents}
                agentStatus={getAgentStatus(sm.agentId)}
                isTypingIndicator
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
              <MessageBubble
                key={`thinking-${agentId}`}
                message={makeIndicatorMessage(agentId, fallbackName)}
                isAgent
                agentName={fallbackName}
                agentAvatar={fallbackAvatar}
                agents={agents}
                agentStatus={getAgentStatus(agentId)}
                isTypingIndicator
              />
            );
          })}

        <div ref={bottomRef} />
      </div>
      </div>

      {/* Scroll to message start — appears when the last agent message's top is out of view */}
      {showScrollToStart && (
        <button
          onClick={() => {
            dismissedMsgId.current = lastAgentMsgId.current;
            setShowScrollToStart(false);
            // Scroll directly to the last agent message's start
            if (lastAgentMsgId.current) {
              const el = document.getElementById(`msg-${lastAgentMsgId.current}`);
              const container = scrollContainerRef.current;
              if (el && container) {
                const containerRect = container.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();
                const offset = elRect.top - containerRect.top + container.scrollTop - 8;
                container.scrollTo({ top: offset, behavior: "smooth" });
              }
            }
          }}
          className="absolute bottom-3 right-0 h-12 w-12 flex items-center justify-center rounded-[var(--radius-sm)] bg-surface border border-border shadow-md text-foreground-secondary hover:text-foreground hover:border-border-hover transition-all cursor-pointer z-10"
          title="Scroll to start of message (Shift+↑)"
        >
          <ChevronUp className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
