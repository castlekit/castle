"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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
// Hook
// ============================================================================

export function useOpenClaw() {
  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [agents, setAgents] = useState<OpenClawAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch connection status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/openclaw/ping", { method: "POST" });
      const data: OpenClawStatus = await res.json();
      setStatus(data);
      return data;
    } catch {
      setStatus({ ok: false, configured: false, error: "Failed to reach Castle server" });
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    try {
      setAgentsLoading(true);
      const res = await fetch("/api/openclaw/agents");
      if (!res.ok) {
        setAgents([]);
        return;
      }
      const data = await res.json();
      setAgents(data.agents || []);
    } catch {
      setAgents([]);
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  // Refresh everything
  const refresh = useCallback(async () => {
    const newStatus = await fetchStatus();
    if (newStatus?.ok) {
      await fetchAgents();
    }
  }, [fetchStatus, fetchAgents]);

  // Initial data fetch
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const s = await fetchStatus();
      if (!cancelled && s?.ok) {
        await fetchAgents();
      }
    }

    init();
    return () => { cancelled = true; };
  }, [fetchStatus, fetchAgents]);

  // SSE subscription for real-time events
  useEffect(() => {
    const es = new EventSource("/api/openclaw/events");
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const evt: GatewaySSEEvent = JSON.parse(e.data);

        // Handle Castle state changes
        if (evt.event === "castle.state") {
          const payload = evt.payload as { state: string; isConnected: boolean; server?: Record<string, unknown> };
          setStatus((prev) => ({
            ok: payload.isConnected,
            configured: prev?.configured ?? true,
            state: payload.state,
            server: payload.server as OpenClawStatus["server"],
          }));

          // Re-fetch agents when connection state changes to connected
          if (payload.isConnected) {
            fetchAgents();
          }
        }

        // Handle agent-related events -- re-fetch agent list
        if (evt.event?.startsWith("agent.")) {
          fetchAgents();
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects, but update state
      setStatus((prev) => prev ? { ...prev, ok: false, state: "disconnected" } : prev);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [fetchAgents]);

  return {
    // Status
    status,
    isLoading,
    isConnected: status?.ok ?? false,
    isConfigured: status?.configured ?? false,
    latency: status?.latency_ms,
    serverVersion: status?.server?.version,

    // Agents
    agents,
    agentsLoading,

    // Actions
    refresh,
  };
}
