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

/** Max messages to keep in the SWR cache. When exceeded, evict from the
 *  opposite end to prevent unbounded memory growth during long scroll sessions. */
const MAX_CACHED_MESSAGES = 500;

interface UseChatOptions {
  channelId: string;
  defaultAgentId?: string;
  /** When set, loads a window of messages around this ID instead of the latest. */
  anchorMessageId?: string;
}

/** Shape of the SWR cache for message history. */
interface HistoryData {
  messages: ChatMessage[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

interface UseChatReturn {
  // Messages
  messages: ChatMessage[];
  isLoading: boolean;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  loadOlder: () => void;
  loadNewer: () => void;
  loadingOlder: boolean;
  loadingNewer: boolean;

  // Backward-compat aliases
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

  // Errors
  sendError: string | null;
  clearSendError: () => void;
}

export function useChat({ channelId, defaultAgentId, anchorMessageId }: UseChatOptions): UseChatReturn {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [streamingMessages, setStreamingMessages] = useState<Map<string, StreamingMessage>>(new Map());
  const streamingRef = useRef<Map<string, StreamingMessage>>(new Map());
  const [currentSessionKey, setCurrentSessionKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);

  // Track active runIds for reconnection timeout
  const activeRunIds = useRef<Set<string>>(new Set());
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
  // When anchorMessageId is set, fetch a window around it.
  // Otherwise fetch the latest messages (default behavior).
  const swrKey = channelId
    ? anchorMessageId
      ? `/api/openclaw/chat?channelId=${channelId}&limit=50&around=${anchorMessageId}`
      : `/api/openclaw/chat?channelId=${channelId}&limit=50`
    : null;

  const {
    data: historyData,
    isLoading,
    mutate: mutateHistory,
  } = useSWR(
    swrKey,
    historyFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  // Deduplicate by message ID — race conditions between SWR revalidation,
  // loadMore pagination, and orphan EventSource can produce duplicate entries.
  const messages: ChatMessage[] = (() => {
    const raw = historyData?.messages ?? [];
    const seen = new Set<string>();
    return raw.filter((m: ChatMessage) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  })();

  // Derive bidirectional pagination flags.
  // Default mode returns { hasMore }, anchor mode returns { hasMoreBefore, hasMoreAfter }.
  const hasMoreBefore: boolean = historyData?.hasMoreBefore ?? historyData?.hasMore ?? false;
  const hasMoreAfter: boolean = historyData?.hasMoreAfter ?? false;

  // ---------------------------------------------------------------------------
  // Load older (backward pagination)
  // ---------------------------------------------------------------------------
  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMoreBefore || messages.length === 0) return;
    setLoadingOlder(true);

    const oldestId = messages[0]?.id;
    try {
      const res = await fetch(
        `/api/openclaw/chat?channelId=${channelId}&limit=50&before=${oldestId}`
      );
      if (res.ok) {
        const data = await res.json();
        const olderMessages: ChatMessage[] = data.messages ?? [];
        if (olderMessages.length > 0) {
          // Prepend older messages to the SWR cache (dedup on merge)
          // Evict from the newer end if cache exceeds MAX_CACHED_MESSAGES
          mutateHistory(
            (current: HistoryData | undefined) => {
              const existing = current?.messages ?? [];
              const existingIds = new Set(existing.map((m) => m.id));
              const unique = olderMessages.filter((m: ChatMessage) => !existingIds.has(m.id));
              let merged = [...unique, ...existing];
              let hasMoreAfter = current?.hasMoreAfter ?? false;
              if (merged.length > MAX_CACHED_MESSAGES) {
                merged = merged.slice(0, MAX_CACHED_MESSAGES);
                hasMoreAfter = true;
              }
              return {
                messages: merged,
                hasMoreBefore: data.hasMore,
                hasMoreAfter,
              };
            },
            { revalidate: false }
          );
        }
      }
    } catch (err) {
      console.error("[useChat] Load older failed:", err);
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, hasMoreBefore, messages, channelId, mutateHistory]);

  // ---------------------------------------------------------------------------
  // Load newer (forward pagination) — only used in anchor mode
  // ---------------------------------------------------------------------------
  const loadNewer = useCallback(async () => {
    if (loadingNewer || !hasMoreAfter || messages.length === 0) return;
    setLoadingNewer(true);

    const newestId = messages[messages.length - 1]?.id;
    try {
      const res = await fetch(
        `/api/openclaw/chat?channelId=${channelId}&limit=50&after=${newestId}`
      );
      if (res.ok) {
        const data = await res.json();
        const newerMessages: ChatMessage[] = data.messages ?? [];
        if (newerMessages.length > 0) {
          // Append newer messages to the SWR cache (dedup on merge)
          // Evict from the older end if cache exceeds MAX_CACHED_MESSAGES
          mutateHistory(
            (current: HistoryData | undefined) => {
              const existing = current?.messages ?? [];
              const existingIds = new Set(existing.map((m) => m.id));
              const unique = newerMessages.filter((m: ChatMessage) => !existingIds.has(m.id));
              let merged = [...existing, ...unique];
              let hasMoreBefore = current?.hasMoreBefore ?? false;
              if (merged.length > MAX_CACHED_MESSAGES) {
                merged = merged.slice(merged.length - MAX_CACHED_MESSAGES);
                hasMoreBefore = true;
              }
              return {
                messages: merged,
                hasMoreBefore,
                hasMoreAfter: data.hasMore,
              };
            },
            { revalidate: false }
          );
        }
      }
    } catch (err) {
      console.error("[useChat] Load newer failed:", err);
    } finally {
      setLoadingNewer(false);
    }
  }, [loadingNewer, hasMoreAfter, messages, channelId, mutateHistory]);

  // ---------------------------------------------------------------------------
  // SSE: Listen for chat events
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Use the existing SSE endpoint that forwards all gateway events
    const esId = Math.random().toString(36).slice(2, 8);
    console.warn(`[SSE-DIAG] Creating EventSource #${esId} (use-chat)`);
    const es = new EventSource("/api/openclaw/events");
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);

        // ── DIAGNOSTIC LOGGING (remove after debugging) ──────────────
        if (evt.event === "chat") {
          const d = evt.payload;
          const textSnippet = (d?.text ?? d?.message?.content?.[0]?.text ?? "").slice(0, 80);
          console.log(
            `[SSE-DIAG] ES#${esId} event=chat runId=${d?.runId?.slice(0, 8)} state=${d?.state} seq=${d?.seq} textLen=${(d?.text ?? "").length} snippet="${textSnippet}" activeRuns=[${[...activeRunIds.current].map(r => r.slice(0, 8)).join(",")}]`
          );
        }
        // ── END DIAGNOSTIC ───────────────────────────────────────────

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
          if (!activeRunIds.current.has(delta.runId)) {
            console.warn(`[SSE-DIAG] FINAL event for runId=${delta.runId.slice(0, 8)} but NOT in activeRunIds — already timed out?`);
            return;
          }
          console.log(`[SSE-DIAG] FINAL received for runId=${delta.runId.slice(0, 8)}, persisting...`);
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
        console.warn(`[SSE-DIAG] Cleanup ES #${esId}: ORPHANING (${activeRunIds.current.size} active runs)`);
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
        console.warn(`[SSE-DIAG] Cleanup ES #${esId}: CLOSING (no active runs)`);
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
            console.warn(`[SSE-DIAG] 30s TIMEOUT fired for runId=${runId.slice(0, 8)} — elapsed=${now - sm.startedAt}ms, contentLen=${sm.content.length}, marking as INTERRUPTED`);
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
    hasMoreBefore,
    hasMoreAfter,
    loadOlder,
    loadNewer,
    loadingOlder,
    loadingNewer,
    // Backward-compat aliases (used by MessageList's existing scroll-up logic)
    hasMore: hasMoreBefore,
    loadMore: loadOlder,
    loadingMore: loadingOlder,
    streamingMessages,
    isStreaming: streamingMessages.size > 0,
    currentSessionKey,
    sendMessage,
    abortResponse,
    sending,
    sendError,
    clearSendError,
  };
}
