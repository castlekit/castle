"use client";

import { useEffect, useRef, useCallback } from "react";
import useSWR from "swr";

// ============================================================================
// Types
// ============================================================================

export interface OpenClawAgent {
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  emoji: string | null;
}

export interface OpenClawStatus {
  ok: boolean;
  configured: boolean;
  latency_ms?: number;
  state?: string;
  error?: string;
  server?: {
    version?: string;
    connId?: string;
  };
}

interface GatewaySSEEvent {
  event: string;
  payload?: unknown;
  seq?: number;
}

// ============================================================================
// Fetchers
// ============================================================================

const statusFetcher = async (url: string): Promise<OpenClawStatus> => {
  const res = await fetch(url, { method: "POST" });
  return res.json();
};

const agentsFetcher = async (url: string): Promise<OpenClawAgent[]> => {
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.agents || [];
};

// ============================================================================
// Hook
// ============================================================================

/**
 * Shared OpenClaw connection status and agents hook.
 * Uses SWR for cache-based sharing across all components —
 * any component calling useOpenClaw() gets the same cached data without extra fetches.
 *
 * SSE subscription pushes real-time updates that trigger SWR cache invalidation.
 */
export function useOpenClaw() {
  const eventSourceRef = useRef<EventSource | null>(null);

  // ---------------------------------------------------------------------------
  // SWR: Connection status
  // ---------------------------------------------------------------------------
  const {
    data: status,
    error: statusError,
    isLoading: statusLoading,
    mutate: mutateStatus,
  } = useSWR<OpenClawStatus>(
    "/api/openclaw/ping",
    statusFetcher,
    {
      refreshInterval: 60000,        // Background refresh every 60s
      revalidateOnFocus: true,
      dedupingInterval: 10000,       // Dedup rapid calls within 10s
      errorRetryCount: 2,
    }
  );

  const isConnected = status?.ok ?? false;

  // ---------------------------------------------------------------------------
  // SWR: Agents (conditional — only fetch when connected)
  // ---------------------------------------------------------------------------
  const {
    data: agents,
    isLoading: agentsLoading,
    mutate: mutateAgents,
  } = useSWR<OpenClawAgent[]>(
    isConnected ? "/api/openclaw/agents" : null,
    agentsFetcher,
    {
      refreshInterval: 300000,       // Refresh agents every 5 min
      revalidateOnFocus: false,
      dedupingInterval: 30000,       // Dedup within 30s
    }
  );

  // ---------------------------------------------------------------------------
  // Refresh helpers
  // ---------------------------------------------------------------------------
  const refresh = useCallback(async () => {
    await mutateStatus();
    if (isConnected) {
      await mutateAgents();
    }
  }, [mutateStatus, mutateAgents, isConnected]);

  const refreshAgents = useCallback(() => mutateAgents(), [mutateAgents]);

  // ---------------------------------------------------------------------------
  // SSE subscription for real-time events
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const esId = Math.random().toString(36).slice(2, 8);
    console.warn(`[SSE-DIAG] Creating EventSource #${esId} (use-openclaw)`);
    const es = new EventSource("/api/openclaw/events");
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const evt: GatewaySSEEvent = JSON.parse(e.data);

        // Handle Castle state changes — update status via SWR
        if (evt.event === "castle.state") {
          const payload = evt.payload as {
            state: string;
            isConnected: boolean;
            server?: Record<string, unknown>;
          };

          // Optimistically update the SWR cache with the SSE data
          mutateStatus(
            (prev) => ({
              ok: payload.isConnected,
              configured: prev?.configured ?? true,
              state: payload.state,
              server: payload.server as OpenClawStatus["server"],
            }),
            { revalidate: false }
          );

          // Re-fetch agents when connection state changes to connected
          if (payload.isConnected) {
            mutateAgents();
          }
        }

        // Handle agent-related events — re-fetch agent list
        if (evt.event?.startsWith("agent.")) {
          mutateAgents();
        }

        // Handle avatar update events
        if (evt.event === "agentAvatarUpdated") {
          mutateAgents();
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects, but update state
      mutateStatus(
        (prev) => prev ? { ...prev, ok: false, state: "disconnected" } : prev,
        { revalidate: false }
      );
    };

    return () => {
      console.warn(`[SSE-DIAG] Cleanup ES #${esId} (use-openclaw): CLOSING`);
      es.close();
      eventSourceRef.current = null;
    };
  }, [mutateStatus, mutateAgents]);

  return {
    // Status
    status,
    isLoading: statusLoading,
    isError: !!statusError,
    isConnected,
    isConfigured: status?.configured ?? false,
    latency: status?.latency_ms,
    serverVersion: status?.server?.version,

    // Agents
    agents: agents ?? [],
    agentsLoading,

    // Actions
    refresh,
    refreshAgents,
  };
}
