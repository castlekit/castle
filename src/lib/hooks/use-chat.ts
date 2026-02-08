"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import type {
  ChatMessage,
  StreamingMessage,
  ChatDelta,
  ChatSendResponse,
  ChatCompleteRequest,
} from "@/lib/types/chat";
import { setAgentThinking, setAgentActive } from "@/lib/hooks/use-agent-status";

// ============================================================================
// Fetcher
// ============================================================================

const historyFetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load messages");
  return res.json();
};

// ============================================================================
// Orphaned run handler (module-level singleton)
// ============================================================================
//
// When a chat component unmounts while an agent is still processing,
// we hand off its EventSource and active runs to this module-level handler.
// It continues processing SSE events so "final"/"error" events persist
// the completed message to the DB. Without this, messages are lost on nav.
//
// Uses a single shared EventSource to avoid exhausting the browser's
// per-origin connection limit when the user navigates between many channels.

interface OrphanedRun {
  channelId: string;
  agentId: string;
  agentName: string;
  sessionKey: string;
  content: string;
  startedAt: number;
}

// Singleton state — shared across all unmounted chat instances
const orphanedRuns = new Map<string, OrphanedRun>();
let orphanedES: EventSource | null = null;
let orphanedSafetyTimer: ReturnType<typeof setTimeout> | null = null;

function cleanupOrphaned() {
  if (orphanedSafetyTimer) {
    clearTimeout(orphanedSafetyTimer);
    orphanedSafetyTimer = null;
  }
  orphanedES?.close();
  orphanedES = null;
  orphanedRuns.clear();
}

function persistOrphanedRun(
  runId: string,
  run: OrphanedRun,
  delta: ChatDelta,
  status: "complete" | "interrupted",
) {
  orphanedRuns.delete(runId);
  setAgentActive(run.agentId);

  const content = status === "complete"
    ? (delta.text || delta.message?.content?.[0]?.text || run.content)
    : run.content;

  if (content) {
    const payload: ChatCompleteRequest = {
      runId,
      channelId: run.channelId,
      content,
      sessionKey: delta.sessionKey || run.sessionKey,
      agentId: run.agentId,
      agentName: run.agentName,
      status,
      ...(status === "complete" && {
        inputTokens: delta.message?.inputTokens,
        outputTokens: delta.message?.outputTokens,
      }),
    };

    fetch("/api/openclaw/chat", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(() => {
        // Trigger SWR revalidation so the message shows when user navigates back
        globalMutate(
          (key) =>
            typeof key === "string" &&
            key.startsWith(`/api/openclaw/chat?channelId=${run.channelId}`),
        );
      })
      .catch((err) => console.error("[useChat] Orphan persist failed:", err));
  }

  // All runs done — tear down
  if (orphanedRuns.size === 0) {
    cleanupOrphaned();
  }
}

function attachOrphanedHandler() {
  if (!orphanedES) return;

  orphanedES.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data);
      if (evt.event !== "chat") return;

      const delta = evt.payload as ChatDelta;
      if (!delta?.runId || !orphanedRuns.has(delta.runId)) return;

      const run = orphanedRuns.get(delta.runId)!;

      if (delta.state === "delta") {
        const text = delta.text ?? delta.message?.content?.[0]?.text ?? "";
        if (text) run.content += text;
      } else if (delta.state === "final") {
        persistOrphanedRun(delta.runId, run, delta, "complete");
      } else if (delta.state === "error") {
        persistOrphanedRun(delta.runId, run, delta, "interrupted");
      }
    } catch {
      // Ignore parse errors
    }
  };
}

/**
 * Hand off an EventSource and its active runs to the module-level handler.
 * Multiple unmounts merge into a single shared connection.
 */
function orphanEventSource(
  es: EventSource,
  newRuns: Map<string, OrphanedRun>,
) {
  // Merge new runs into the shared state
  for (const [runId, run] of newRuns) {
    orphanedRuns.set(runId, run);
  }

  if (orphanedES && orphanedES !== es) {
    // Already have an orphaned ES — close the old one and use the newer
    // (fresher) connection
    orphanedES.close();
  }
  orphanedES = es;
  attachOrphanedHandler();

  // Reset safety timer (5 min) so stale connections don't leak
  if (orphanedSafetyTimer) clearTimeout(orphanedSafetyTimer);
  orphanedSafetyTimer = setTimeout(cleanupOrphaned, 5 * 60 * 1000);
}

// ============================================================================
// Hook
// ============================================================================

interface UseChatOptions {
  channelId: string;
  defaultAgentId?: string;
}

interface UseChatReturn {
  // Messages
  messages: ChatMessage[];
  isLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;

  // Streaming
  streamingMessages: Map<string, StreamingMessage>;
  isStreaming: boolean;

  // Session
  currentSessionKey: string | null;

  // Actions
  sendMessage: (content: string, agentId?: string) => Promise<void>;
  abortResponse: () => Promise<void>;
  sending: boolean;

  // Search
  searchResults: ChatMessage[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  isSearching: boolean;

  // Errors
  sendError: string | null;
  clearSendError: () => void;
}

export function useChat({ channelId, defaultAgentId }: UseChatOptions): UseChatReturn {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [streamingMessages, setStreamingMessages] = useState<Map<string, StreamingMessage>>(new Map());
  const streamingRef = useRef<Map<string, StreamingMessage>>(new Map());
  const [currentSessionKey, setCurrentSessionKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [searchQuery, setSearchQueryState] = useState("");
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [beforeCursor, setBeforeCursor] = useState<string | undefined>(undefined);

  // Track active runIds for reconnection timeout
  const activeRunIds = useRef<Set<string>>(new Set());
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Helper: update both streaming state and ref in sync
  const updateStreaming = useCallback((updater: (prev: Map<string, StreamingMessage>) => Map<string, StreamingMessage>) => {
    setStreamingMessages((prev) => {
      const next = updater(prev);
      streamingRef.current = next;
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // SWR: Message history
  // ---------------------------------------------------------------------------
  const {
    data: historyData,
    isLoading,
    mutate: mutateHistory,
  } = useSWR(
    channelId ? `/api/openclaw/chat?channelId=${channelId}&limit=50` : null,
    historyFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const messages: ChatMessage[] = historyData?.messages ?? [];
  const hasMore: boolean = historyData?.hasMore ?? false;

  // ---------------------------------------------------------------------------
  // Load more (pagination)
  // ---------------------------------------------------------------------------
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);

    const oldestId = messages[0]?.id;
    try {
      const res = await fetch(
        `/api/openclaw/chat?channelId=${channelId}&limit=50&before=${oldestId}`
      );
      if (res.ok) {
        const data = await res.json();
        const olderMessages: ChatMessage[] = data.messages ?? [];
        if (olderMessages.length > 0) {
          // Prepend older messages to the SWR cache
          mutateHistory(
            (current: { messages: ChatMessage[]; hasMore: boolean } | undefined) => ({
              messages: [...olderMessages, ...(current?.messages ?? [])],
              hasMore: data.hasMore,
            }),
            { revalidate: false }
          );
        }
      }
    } catch (err) {
      console.error("[useChat] Load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, messages, channelId, mutateHistory]);

  // ---------------------------------------------------------------------------
  // SSE: Listen for chat events
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Use the existing SSE endpoint that forwards all gateway events
    const es = new EventSource("/api/openclaw/events");
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);

        // Only handle chat events
        if (evt.event !== "chat") return;

        const delta = evt.payload as ChatDelta;
        if (!delta?.runId) return;

        // Only process events for our active runs
        if (!activeRunIds.current.has(delta.runId)) return;

        if (delta.state === "delta") {
          // Accumulate streaming text
          const text = delta.text ?? delta.message?.content?.[0]?.text ?? "";
          if (text) {
            updateStreaming((prev) => {
              const next = new Map(prev);
              const existing = next.get(delta.runId);
              if (existing) {
                next.set(delta.runId, {
                  ...existing,
                  content: existing.content + text,
                });
              } else {
                // Placeholder hasn't been created yet (race with POST response)
                next.set(delta.runId, {
                  runId: delta.runId,
                  agentId: defaultAgentId || "",
                  agentName: "",
                  sessionKey: delta.sessionKey,
                  content: text,
                  startedAt: Date.now(),
                });
              }
              return next;
            });
          }

          // Update sessionKey if provided
          if (delta.sessionKey) {
            setCurrentSessionKey(delta.sessionKey);
          }
        } else if (delta.state === "final") {
          // Guard: if we already processed this runId's final, skip
          if (!activeRunIds.current.has(delta.runId)) return;
          activeRunIds.current.delete(delta.runId);

          // Read accumulated content from the ref (always current, no stale closure)
          const sm = streamingRef.current.get(delta.runId);
          const accumulatedContent = sm?.content || "";
          const finalContent =
            delta.text ||
            delta.message?.content?.[0]?.text ||
            accumulatedContent;
          const streamAgentId = sm?.agentId || defaultAgentId || "";
          const streamAgentName = sm?.agentName;
          const streamSessionKey =
            delta.sessionKey || sm?.sessionKey || "";

          // Ensure typing indicator shows for at least 800ms
          const MIN_INDICATOR_MS = 800;
          const elapsed = sm?.startedAt ? Date.now() - sm.startedAt : MIN_INDICATOR_MS;
          const remaining = Math.max(0, MIN_INDICATOR_MS - elapsed);

          const persistAndCleanup = () => {
            // Mark agent as active (2 min timer back to idle)
            setAgentActive(streamAgentId);

            // Persist to DB, then reload history, then remove streaming placeholder
            if (finalContent) {
              const completePayload: ChatCompleteRequest = {
                runId: delta.runId,
                channelId,
                content: finalContent,
                sessionKey: streamSessionKey,
                agentId: streamAgentId,
                agentName: streamAgentName,
                status: "complete",
                inputTokens: delta.message?.inputTokens,
                outputTokens: delta.message?.outputTokens,
              };

              fetch("/api/openclaw/chat", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(completePayload),
              })
                .then((res) => {
                  if (!res.ok) {
                    console.error("[useChat] PUT failed:", res.status);
                  }
                  return mutateHistory();
                })
                .then(() => {
                  // Only remove streaming message AFTER history has reloaded
                  updateStreaming((prev) => {
                    const next = new Map(prev);
                    next.delete(delta.runId);
                    return next;
                  });
                })
                .catch((err) => {
                  console.error("[useChat] Complete persist failed:", err);
                  updateStreaming((prev) => {
                    const next = new Map(prev);
                    next.delete(delta.runId);
                    return next;
                  });
                });
            } else {
              // No content at all — just clean up
              updateStreaming((prev) => {
                const next = new Map(prev);
                next.delete(delta.runId);
                return next;
              });
            }
          };

          // Wait for minimum indicator time, then persist
          if (remaining > 0) {
            setTimeout(persistAndCleanup, remaining);
          } else {
            persistAndCleanup();
          }
        } else if (delta.state === "error") {
          console.error("[useChat] Stream error:", delta.errorMessage);

          // Read accumulated content from ref
          const sm = streamingRef.current.get(delta.runId);
          const errorContent = sm?.content || "";
          const errorAgentId = sm?.agentId || defaultAgentId || "";
          const errorAgentName = sm?.agentName;

          // Mark agent as active even on error (it did work)
          setAgentActive(errorAgentId);

          // Remove streaming message immediately for errors
          activeRunIds.current.delete(delta.runId);
          updateStreaming((prev) => {
            const next = new Map(prev);
            next.delete(delta.runId);
            return next;
          });

          // Save partial if we have content
          if (errorContent) {
            const errorPayload: ChatCompleteRequest = {
              runId: delta.runId,
              channelId,
              content: errorContent,
              sessionKey: delta.sessionKey || sm?.sessionKey || "",
              agentId: errorAgentId,
              agentName: errorAgentName,
              status: "interrupted",
            };

            fetch("/api/openclaw/chat", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(errorPayload),
            }).then(() => mutateHistory())
              .catch(() => {});
          }

          setSendError(delta.errorMessage || "Stream error");
        }
      } catch {
        // Ignore parse errors
      }
    };

    return () => {
      if (activeRunIds.current.size > 0) {
        // Agent is still processing — hand off the EventSource to the
        // module-level handler so "final" events still get persisted
        // even though the component is unmounting.
        const runs = new Map<string, OrphanedRun>();
        for (const runId of activeRunIds.current) {
          const sm = streamingRef.current.get(runId);
          if (sm) {
            runs.set(runId, {
              channelId,
              agentId: sm.agentId,
              agentName: sm.agentName,
              sessionKey: sm.sessionKey,
              content: sm.content,
              startedAt: sm.startedAt,
            });
          }
        }
        orphanEventSource(es, runs);
      } else {
        es.close();
      }
      eventSourceRef.current = null;
    };
  // We intentionally omit streamingMessages and currentSessionKey from deps
  // to prevent re-creating the EventSource on every state change.
  // The event handler accesses them via closure that stays fresh enough.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, defaultAgentId, mutateHistory, updateStreaming]);

  // ---------------------------------------------------------------------------
  // Reconnection timeout: mark in-flight runIds as interrupted after 30s
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // When streamingMessages changes, check for stale runs
    const timer = setTimeout(() => {
      const now = Date.now();
      updateStreaming((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const [runId, sm] of next) {
          if (now - sm.startedAt > 30000) {
            // Save partial
            if (sm.content) {
              fetch("/api/openclaw/chat", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  runId,
                  channelId,
                  content: sm.content,
                  sessionKey: sm.sessionKey,
                  agentId: sm.agentId,
                  agentName: sm.agentName,
                  status: "interrupted",
                } satisfies ChatCompleteRequest),
              }).then(() => mutateHistory())
                .catch(() => {});
            }
            activeRunIds.current.delete(runId);
            next.delete(runId);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 30000);

    return () => clearTimeout(timer);
  }, [streamingMessages, channelId, mutateHistory, updateStreaming]);

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------
  const sendMessage = useCallback(
    async (content: string, agentId?: string) => {
      if (!content.trim() || sending) return;

      setSending(true);
      setSendError(null);

      try {
        const res = await fetch("/api/openclaw/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelId,
            content,
            agentId: agentId || defaultAgentId,
          }),
        });

        // Safely parse the JSON response
        let result: ChatSendResponse;
        try {
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || `Send failed (${res.status})`);
          }
          result = data;
        } catch (parseErr) {
          if (!res.ok) {
            throw new Error(`Send failed (${res.status})`);
          }
          throw new Error(`Invalid response from server: ${(parseErr as Error).message}`);
        }

        // Update session key
        if (result.sessionKey) {
          setCurrentSessionKey(result.sessionKey);
        }

        // Track this run for streaming
        activeRunIds.current.add(result.runId);

        // Refresh history to show the persisted user message
        mutateHistory();

        // Random delay before showing typing indicator — feels natural
        const delay = 800 + Math.random() * 400;
        await new Promise((resolve) => setTimeout(resolve, delay));

        // Add streaming placeholder — shows typing indicator
        const resolvedAgentId = agentId || defaultAgentId || "";
        setAgentThinking(resolvedAgentId, channelId);

        updateStreaming((prev) => {
          const next = new Map(prev);
          next.set(result.runId, {
            runId: result.runId,
            agentId: resolvedAgentId,
            agentName: "",
            sessionKey: result.sessionKey,
            content: "",
            startedAt: Date.now(),
          });
          return next;
        });
      } catch (err) {
        setSendError((err as Error).message);
      } finally {
        setSending(false);
      }
    },
    [channelId, defaultAgentId, sending, mutateHistory, updateStreaming]
  );

  // ---------------------------------------------------------------------------
  // Abort response
  // ---------------------------------------------------------------------------
  const abortResponse = useCallback(async () => {
    try {
      await fetch("/api/openclaw/chat", { method: "DELETE" });

      // Save partial content for all active streams
      updateStreaming((prev) => {
        for (const [runId, sm] of prev) {
          if (sm.content) {
            fetch("/api/openclaw/chat", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                runId,
                channelId,
                content: sm.content,
                sessionKey: sm.sessionKey,
                agentId: sm.agentId,
                agentName: sm.agentName,
                status: "aborted",
              } satisfies ChatCompleteRequest),
            }).then(() => mutateHistory())
              .catch(() => {});
          }
          activeRunIds.current.delete(runId);
        }
        return new Map();
      });
    } catch (err) {
      console.error("[useChat] Abort failed:", err);
    }
  }, [channelId, mutateHistory, updateStreaming]);

  // ---------------------------------------------------------------------------
  // Search (debounced FTS5)
  // ---------------------------------------------------------------------------
  const setSearchQuery = useCallback(
    (q: string) => {
      setSearchQueryState(q);

      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }

      if (!q.trim()) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      searchTimerRef.current = setTimeout(async () => {
        try {
          const res = await fetch(
            `/api/openclaw/chat/search?q=${encodeURIComponent(q)}&channelId=${channelId}`
          );
          if (res.ok) {
            const data = await res.json();
            setSearchResults(data.results ?? []);
          }
        } catch {
          setSearchResults([]);
        } finally {
          setIsSearching(false);
        }
      }, 300);
    },
    [channelId]
  );

  // Cleanup search timer
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Clear error
  // ---------------------------------------------------------------------------
  const clearSendError = useCallback(() => setSendError(null), []);

  // Auto-dismiss error after 5s
  useEffect(() => {
    if (!sendError) return;
    const t = setTimeout(() => setSendError(null), 5000);
    return () => clearTimeout(t);
  }, [sendError]);

  return {
    messages,
    isLoading,
    hasMore,
    loadMore,
    loadingMore,
    streamingMessages,
    isStreaming: streamingMessages.size > 0,
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
  };
}
