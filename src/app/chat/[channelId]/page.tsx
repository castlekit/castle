"use client";

import { use, useState } from "react";
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
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <h2 className="text-sm font-semibold text-foreground">Channel</h2>
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
