"use client";

import { use, useState, useEffect } from "react";
import { WifiOff, X, AlertCircle, Search } from "lucide-react";
import { useOpenClaw } from "@/lib/hooks/use-openclaw";
import { useChat } from "@/lib/hooks/use-chat";
import { useSessionStats } from "@/lib/hooks/use-session-stats";
import { MessageList } from "@/components/chat/message-list";
import { ChatInput } from "@/components/chat/chat-input";
import { SessionStatsPanel } from "@/components/chat/session-stats-panel";
import { SearchPanel } from "@/components/chat/search-panel";
import { ChatErrorBoundary } from "./error-boundary";
import type { AgentInfo } from "@/components/chat/agent-mention-popup";

interface ChannelPageProps {
  params: Promise<{ channelId: string }>;
}

function ChannelChatContent({ channelId }: { channelId: string }) {
  const { agents, isConnected, isLoading: gatewayLoading } = useOpenClaw();
  const [showSearch, setShowSearch] = useState(false);
  const [channelName, setChannelName] = useState<string>("");
  const [channelAgentIds, setChannelAgentIds] = useState<string[]>([]);
  const [displayName, setDisplayName] = useState<string>("");

  // Mark this channel as last accessed and fetch channel info + user settings
  useEffect(() => {
    // Touch (mark as last accessed)
    fetch("/api/openclaw/chat/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "touch", id: channelId }),
    }).catch(() => {});

    // Fetch channel details for the name and agents
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
        }
      })
      .catch(() => {});

    // Fetch user display name
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.displayName) setDisplayName(data.displayName);
      })
      .catch(() => {});
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
    streamingMessages,
    isStreaming,
    currentSessionKey,
    sendMessage,
    abortResponse,
    sending,
    searchResults,
    searchQuery,
    setSearchQuery,
    isSearching,
    sendError,
    clearSendError,
  } = useChat({ channelId, defaultAgentId });

  const { stats, isLoading: statsLoading } = useSessionStats({
    sessionKey: currentSessionKey,
  });

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Channel header — sticky */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {channelName || "Channel"}
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
        </div>
        <button
          onClick={() => setShowSearch(!showSearch)}
          className="p-1.5 rounded-md text-foreground-secondary hover:text-foreground hover:bg-surface-hover transition-colors"
          title="Search messages (Ctrl+F)"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {/* Search panel — sticky */}
      {showSearch && (
        <div className="shrink-0">
          <SearchPanel
            query={searchQuery}
            onQueryChange={setSearchQuery}
            results={searchResults}
            isSearching={isSearching}
            onClose={() => {
              setShowSearch(false);
              setSearchQuery("");
            }}
          />
        </div>
      )}

      {/* Connection warning banner — sticky */}
      {!isConnected && !gatewayLoading && (
        <div className="px-4 py-2 bg-error/10 border-b border-error/20 flex items-center gap-2 text-sm text-error shrink-0">
          <WifiOff className="h-4 w-4" />
          <span>Gateway disconnected. Reconnecting...</span>
        </div>
      )}

      {/* Session stats — sticky */}
      <div className="shrink-0">
        <SessionStatsPanel stats={stats} isLoading={statsLoading} />
      </div>

      {/* Messages — this is the ONLY scrollable area */}
      <MessageList
        messages={messages}
        loading={isLoading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        agents={chatAgents}
        streamingMessages={streamingMessages}
        onLoadMore={loadMore}
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

      {/* Input — sticky at bottom */}
      <div className="border-t border-border p-4 shrink-0">
        <ChatInput
          onSend={sendMessage}
          onAbort={abortResponse}
          sending={sending}
          streaming={isStreaming}
          disabled={!isConnected && !gatewayLoading}
          agents={chatAgents}
          defaultAgentId={defaultAgentId}
          channelId={channelId}
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
