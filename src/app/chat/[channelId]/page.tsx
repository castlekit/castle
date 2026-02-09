"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { WifiOff, X, AlertCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOpenClaw } from "@/lib/hooks/use-openclaw";
import { useChat } from "@/lib/hooks/use-chat";
import { useSessionStats } from "@/lib/hooks/use-session-stats";
import { useCompactionEvents } from "@/lib/hooks/use-compaction-events";
import { useContextBoundary } from "@/lib/hooks/use-context-boundary";
import { useUserSettings } from "@/lib/hooks/use-user-settings";
import { MessageList } from "@/components/chat/message-list";
import { ChatInput } from "@/components/chat/chat-input";
import { SessionStatsIndicator } from "@/components/chat/session-stats-panel";
import { SearchTrigger } from "@/components/providers/search-provider";
import { ChatErrorBoundary } from "./error-boundary";
import type { AgentInfo } from "@/components/chat/agent-mention-popup";

interface ChannelPageProps {
  params: Promise<{ channelId: string }>;
}

// Module-level flag: once any channel has rendered real content, subsequent
// channel switches use a smooth opacity transition instead of the skeleton.
// NOTE: This persists for the entire browser session and never resets.
// If Castle ever supports logout or multi-user, this will need a reset mechanism.
let hasEverRendered = false;

// ---------------------------------------------------------------------------
// Skeleton loader — Facebook-style placeholder while data loads
// ---------------------------------------------------------------------------
const LINE_WIDTHS = ["80%", "60%", "40%", "75%", "55%", "85%", "45%", "70%", "50%"];

function SkeletonMessage({ lines = 2, short = false, offset = 0 }: { lines?: number; short?: boolean; offset?: number }) {
  return (
    <div className="flex gap-3 mb-[4px]">
      <div className="skeleton w-9 h-9 rounded-full shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1.5 flex-1">
        <div className="flex items-center gap-2">
          <div className={cn("skeleton h-3.5", short ? "w-16" : "w-24")} />
          <div className="skeleton h-3 w-14" />
        </div>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="skeleton h-3.5"
            style={{ width: LINE_WIDTHS[(offset + i) % LINE_WIDTHS.length] }}
          />
        ))}
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header skeleton */}
      <div className="py-4 border-b border-border shrink-0 min-h-[83px] flex items-center">
        <div>
          <div className="skeleton h-5 w-40 mb-1.5" />
          <div className="skeleton h-3.5 w-28" />
        </div>
      </div>

      {/* Messages skeleton */}
      <div className="flex-1 overflow-hidden py-[20px] pr-[20px] flex flex-col justify-end">
        <div className="flex flex-col gap-6">
          <SkeletonMessage lines={3} offset={0} />
          <SkeletonMessage lines={1} short offset={3} />
          <SkeletonMessage lines={2} offset={4} />
          <SkeletonMessage lines={1} short offset={6} />
          <SkeletonMessage lines={2} offset={7} />
          <SkeletonMessage lines={3} offset={1} />
          <SkeletonMessage lines={1} short offset={5} />
        </div>
      </div>

      {/* Real input, just disabled while loading */}
      <div className="shrink-0">
        <ChatInput
          onSend={() => Promise.resolve()}
          onAbort={() => Promise.resolve()}
          sending={false}
          streaming={false}
          disabled
          agents={[]}
          channelId=""
        />
      </div>
    </div>
  );
}

function ChannelChatContent({ channelId }: { channelId: string }) {
  // Read ?m= param for scroll-to-message from search results.
  // useSearchParams() is reactive — it updates when the query string
  // changes, even for same-channel navigation (e.g. clicking two
  // different search results in the same channel).
  const searchParams = useSearchParams();
  const highlightMessageId = searchParams.get("m") || undefined;
  const { agents, isConnected, isLoading: gatewayLoading, agentsLoading } = useOpenClaw();
  const [channelName, setChannelName] = useState<string | null>(null);
  const [channelAgentIds, setChannelAgentIds] = useState<string[]>([]);
  const [channelCreatedAt, setChannelCreatedAt] = useState<number | null>(null);
  const [channelArchived, setChannelArchived] = useState(false);
  const { displayName, avatarUrl: userAvatar, isLoading: userSettingsLoading } = useUserSettings();

  // Mark this channel as last accessed and fetch channel info
  useEffect(() => {
    // Touch (mark as last accessed)
    fetch("/api/openclaw/chat/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "touch", id: channelId }),
    }).catch(() => {});

    // Fetch channel details for the name and agents.
    // Try active channels first, then archived if not found.
    // Falls back to channelId as name if both fail (prevents stuck loading).
    fetch("/api/openclaw/chat/channels")
      .then((r) => r.json())
      .then((data) => {
        const ch = (data.channels || []).find(
          (c: { id: string; name: string; agents?: string[] }) =>
            c.id === channelId
        );
        if (ch) {
          setChannelName(ch.name);
          setChannelAgentIds(ch.agents || []);
          setChannelCreatedAt(ch.createdAt ?? null);
          setChannelArchived(false);
        } else {
          // Channel not in active list — check archived channels
          return fetch("/api/openclaw/chat/channels?archived=1")
            .then((r) => r.json())
            .then((archived) => {
              const archivedCh = (archived.channels || []).find(
                (c: { id: string; name: string; agents?: string[] }) =>
                  c.id === channelId
              );
              if (archivedCh) {
                setChannelName(archivedCh.name);
                setChannelAgentIds(archivedCh.agents || []);
                setChannelCreatedAt(archivedCh.createdAt ?? null);
                setChannelArchived(true);
              } else {
                // Channel not found anywhere — use ID as fallback name
                setChannelName("Chat");
              }
            });
        }
      })
      .catch(() => {
        // Network error — fall back so page doesn't stay stuck
        setChannelName("Chat");
      });
  }, [channelId]);

  // Map agents to the AgentInfo format used by chat components
  const chatAgents: AgentInfo[] = agents.map((a) => ({
    id: a.id,
    name: a.name,
    avatar: a.avatar,
  }));

  // Get default agent (first in list)
  const defaultAgentId = agents[0]?.id;

  const {
    messages,
    isLoading,
    hasMore,
    loadMore,
    loadingMore,
    hasMoreAfter,
    loadNewer,
    loadingNewer,
    streamingMessages,
    isStreaming,
    currentSessionKey,
    sendMessage,
    abortResponse,
    sending,
    sendError,
    clearSendError,
  } = useChat({ channelId, defaultAgentId, anchorMessageId: highlightMessageId });

  const { stats, isLoading: statsLoading, refresh: refreshStats } = useSessionStats({
    sessionKey: currentSessionKey,
  });

  const { boundaryMessageId, refresh: refreshBoundary } = useContextBoundary({
    sessionKey: currentSessionKey,
    channelId,
  });

  const { isCompacting, showBanner: showCompactionBanner, dismissBanner, compactionCount: liveCompactionCount } = useCompactionEvents({
    sessionKey: currentSessionKey,
    onCompactionComplete: () => {
      refreshStats();
      refreshBoundary();
    },
  });

  // Ref to the navigate-between-messages function exposed by MessageList
  const navigateRef = useRef<((direction: "up" | "down") => void) | null>(null);

  // Handle Shift+ArrowUp/Down to navigate between messages
  const handleNavigate = useCallback((direction: "up" | "down") => {
    navigateRef.current?.(direction);
  }, []);

  // Don't render until channel name, agents, and user settings have all loaded.
  const channelReady = channelName !== null && !agentsLoading && !userSettingsLoading;

  // First cold load → skeleton. If agents/user are already cached (e.g.
  // navigated from dashboard) or we've rendered before, use opacity transition.
  const dataAlreadyCached = !agentsLoading && !userSettingsLoading;
  if (channelReady) hasEverRendered = true;

  if (!channelReady && !hasEverRendered && !dataAlreadyCached) {
    return <ChatSkeleton />;
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Channel header — always visible, never fades */}
      <div className="pt-[7px] pb-[30px] border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-4">
          {/* Left: channel name + participants */}
          <div className="min-w-0 min-h-[45px]">
            {channelName ? (
              <>
                <h2 className="text-lg font-semibold text-foreground leading-tight">
                  {channelName}
                  {channelArchived && (
                    <span className="ml-2 text-sm font-normal text-foreground-secondary">(Archived)</span>
                  )}
                </h2>
                {(displayName || channelAgentIds.length > 0) && agents.length > 0 && (
                  <p className="text-sm text-foreground-secondary mt-0.5">
                    with{" "}
                    {(() => {
                      const names = [
                        displayName,
                        ...channelAgentIds.map(
                          (id) => agents.find((a) => a.id === id)?.name || id
                        ),
                      ].filter(Boolean);
                      if (names.length <= 2) return names.join(" & ");
                      return names.slice(0, -1).join(", ") + " & " + names[names.length - 1];
                    })()}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="skeleton h-5 w-40 rounded mb-1.5" />
                <div className="skeleton h-3.5 w-28 rounded" />
              </>
            )}
          </div>
          {/* Right: session stats + search */}
          <div className="flex items-center gap-5 shrink-0">
            <SessionStatsIndicator
              stats={stats}
              isLoading={statsLoading}
              isCompacting={isCompacting}
              liveCompactionCount={liveCompactionCount}
            />
            <SearchTrigger />
          </div>
        </div>
      </div>

      {/* Content area */}
      {!channelReady ? (
        /* Skeleton messages while loading */
        <div className="flex-1 overflow-hidden py-[20px] pr-[20px] flex flex-col justify-end">
          <div className="flex flex-col gap-6">
            <SkeletonMessage lines={3} offset={0} />
            <SkeletonMessage lines={1} short offset={3} />
            <SkeletonMessage lines={2} offset={4} />
            <SkeletonMessage lines={1} short offset={6} />
            <SkeletonMessage lines={2} offset={7} />
            <SkeletonMessage lines={3} offset={1} />
          </div>
        </div>
      ) : (
      <div className="flex-1 flex flex-col overflow-hidden">

      {/* Connection warning banner — sticky */}
      {!isConnected && !gatewayLoading && (
        <div className="px-4 py-2 bg-error/10 border-b border-error/20 flex items-center gap-2 text-sm text-error shrink-0">
          <WifiOff className="h-4 w-4" />
          <span>Gateway disconnected. Reconnecting...</span>
        </div>
      )}

      {/* Compaction banner */}
      {showCompactionBanner && (
        <div className="px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20 flex items-center justify-between text-sm text-yellow-600 dark:text-yellow-400 shrink-0">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            <span>Context compacted — older messages have been summarized</span>
          </div>
          <button
            onClick={dismissBanner}
            className="p-1 hover:bg-yellow-500/20 rounded"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Messages — this is the ONLY scrollable area */}
      <MessageList
        messages={messages}
        loading={isLoading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        agents={chatAgents}
        userAvatar={userAvatar}
        streamingMessages={streamingMessages}
        onLoadMore={loadMore}
        hasMoreAfter={hasMoreAfter}
        onLoadNewer={loadNewer}
        loadingNewer={loadingNewer}
        channelId={channelId}
        channelName={channelName}
        channelCreatedAt={channelCreatedAt}
        highlightMessageId={highlightMessageId}
        navigateRef={navigateRef}
        compactionBoundaryMessageId={boundaryMessageId}
        compactionCount={stats?.compactions ?? 0}
      />

      {/* Error toast — sticky above input */}
      {sendError && (
        <div className="mx-4 mb-2 px-4 py-2 rounded-lg bg-error/10 border border-error/20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-sm text-error">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{sendError}</span>
          </div>
          <button
            onClick={clearSendError}
            className="p-1 hover:bg-error/20 rounded"
          >
            <X className="h-3 w-3 text-error" />
          </button>
        </div>
      )}

      </div>
      )}

      {/* Input — always visible, disabled until channel is ready */}
      <div className="shrink-0">
        <ChatInput
          onSend={sendMessage}
          onAbort={abortResponse}
          sending={sending}
          streaming={isStreaming}
          disabled={!channelReady || (!isConnected && !gatewayLoading)}
          agents={chatAgents}
          defaultAgentId={defaultAgentId}
          channelId={channelId}
          onNavigate={handleNavigate}
        />
      </div>
    </div>
  );
}

export default function ChannelPage({ params }: ChannelPageProps) {
  const { channelId } = use(params);

  return (
    <ChatErrorBoundary>
      <ChannelChatContent channelId={channelId} />
    </ChatErrorBoundary>
  );
}
