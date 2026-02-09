"use client";

import { useEffect, useCallback } from "react";
import useSWR from "swr";
import { subscribe, onError, type SSEEvent } from "@/lib/sse-singleton";

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

// ============================================================================
// Fetchers
// ============================================================================

const statusFetcher = async (url: string): Promise<OpenClawStatus> => {
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    console.warn(`[useOpenClaw] Status fetch returned ${res.status}`);
  }
  return res.json();
};

const agentsFetcher = async (url: string): Promise<OpenClawAgent[]> => {
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[useOpenClaw] Agents fetch failed: ${res.status}`);
    return [];
  }
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
  // SSE subscription for real-time events via shared singleton
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleState = (evt: SSEEvent) => {
      const payload = evt.payload as {
        state: string;
        isConnected: boolean;
        server?: Record<string, unknown>;
      };

      mutateStatus(
        (prev) => ({
          ok: payload.isConnected,
          configured: prev?.configured ?? true,
          state: payload.state,
          server: payload.server as OpenClawStatus["server"],
        }),
        { revalidate: false }
      );

      if (payload.isConnected) {
        mutateAgents();
      }
    };

    const handleAgent = (_evt: SSEEvent) => {
      mutateAgents();
    };

    const handleError = () => {
      console.warn("[useOpenClaw] SSE error — marking as disconnected");
      mutateStatus(
        (prev) => prev ? { ...prev, ok: false, state: "disconnected" } : prev,
        { revalidate: false }
      );
    };

    const unsub1 = subscribe("castle.state", handleState);
    const unsub2 = subscribe("agent.*", handleAgent);
    const unsub3 = subscribe("agentAvatarUpdated", handleAgent);
    const unsub4 = onError(handleError);

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
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
