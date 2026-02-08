"use client";

import { useCallback, useEffect } from "react";
import useSWR, { mutate as globalMutate } from "swr";

// ============================================================================
// Types
// ============================================================================

export type AgentStatus = "idle" | "thinking" | "active";

interface AgentStatusRow {
  agentId: string;
  status: AgentStatus;
  updatedAt: number;
}

type StatusMap = Record<string, AgentStatus>;

// ============================================================================
// Constants
// ============================================================================

const SWR_KEY = "/api/openclaw/agents/status";
const CHANNEL_NAME = "agent-status";

// ============================================================================
// Fetcher
// ============================================================================

const statusFetcher = async (url: string): Promise<StatusMap> => {
  const res = await fetch(url);
  if (!res.ok) return {};
  const data = await res.json();
  const map: StatusMap = {};
  for (const row of (data.statuses || []) as AgentStatusRow[]) {
    map[row.agentId] = row.status;
  }
  return map;
};

// ============================================================================
// BroadcastChannel: cross-tab real-time sync (no polling needed)
// ============================================================================

let broadcast: BroadcastChannel | null = null;

function getBroadcast(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (!broadcast) {
    try {
      broadcast = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      // BroadcastChannel not supported (e.g. some older browsers)
    }
  }
  return broadcast;
}

// ============================================================================
// Client-side active → idle timers (mirrors the server-side 2 min expiry)
// ============================================================================

const ACTIVE_TIMEOUT_MS = 2 * 60 * 1000;
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleIdleTransition(agentId: string) {
  // Clear any existing timer for this agent
  const existing = activeTimers.get(agentId);
  if (existing) clearTimeout(existing);

  activeTimers.set(
    agentId,
    setTimeout(() => {
      activeTimers.delete(agentId);
      // Explicitly transition to idle — triggers SWR + BroadcastChannel
      updateStatus(agentId, "idle");
    }, ACTIVE_TIMEOUT_MS)
  );
}

function clearIdleTimer(agentId: string) {
  const existing = activeTimers.get(agentId);
  if (existing) {
    clearTimeout(existing);
    activeTimers.delete(agentId);
  }
}

// ============================================================================
// Channel tracking: which channel each agent is currently thinking in
// ============================================================================

const thinkingChannels = new Map<string, string>();

/** Returns the channelId the agent is currently thinking in, or undefined. */
export function getThinkingChannel(agentId: string): string | undefined {
  return thinkingChannels.get(agentId);
}

// ============================================================================
// Exported setters (optimistic SWR + DB persist + cross-tab broadcast)
// ============================================================================

function updateStatus(agentId: string, status: AgentStatus) {
  // 1. Optimistic: update SWR cache immediately (current tab)
  globalMutate(
    SWR_KEY,
    (prev: StatusMap | undefined) => ({ ...prev, [agentId]: status }),
    { revalidate: false }
  );

  // 2. Broadcast to other tabs (instant, no server round-trip)
  getBroadcast()?.postMessage({ agentId, status });

  // 3. Persist to DB via API (fire-and-forget)
  fetch(SWR_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, status }),
  }).catch(() => {
    // Silent — DB will be stale but next page load corrects it
  });
}

export function setAgentThinking(agentId: string, channelId?: string) {
  clearIdleTimer(agentId);
  if (channelId) thinkingChannels.set(agentId, channelId);
  updateStatus(agentId, "thinking");
}

export function setAgentActive(agentId: string) {
  thinkingChannels.delete(agentId);
  updateStatus(agentId, "active");
  // Schedule automatic idle transition after 2 minutes
  scheduleIdleTransition(agentId);
}

export function setAgentIdle(agentId: string) {
  thinkingChannels.delete(agentId);
  clearIdleTimer(agentId);
  updateStatus(agentId, "idle");
}

// ============================================================================
// User presence constants
// ============================================================================

export const USER_STATUS_ID = "__user__";
const USER_IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes of inactivity → idle

// ============================================================================
// Hook
// ============================================================================

/**
 * Shared agent status hook backed by the database.
 * Uses BroadcastChannel for instant cross-tab sync — no polling.
 * On mount, fetches current state from DB (catches up after page load).
 * The server auto-expires "active" statuses older than 2 minutes to "idle".
 *
 * Status lifecycle: idle → thinking → active (2 min server-side) → idle
 */
export function useAgentStatus() {
  const { data: statuses } = useSWR<StatusMap>(SWR_KEY, statusFetcher, {
    fallbackData: {},
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshInterval: 120_000, // Light background poll every 2 min just to catch expired "active" → "idle"
    dedupingInterval: 5000,
  });

  // Listen for cross-tab broadcasts and update SWR cache instantly
  useEffect(() => {
    const bc = getBroadcast();
    if (!bc) return;

    const handler = (e: MessageEvent) => {
      const { agentId, status } = e.data as { agentId: string; status: AgentStatus };
      if (agentId && status) {
        globalMutate(
          SWR_KEY,
          (prev: StatusMap | undefined) => ({ ...prev, [agentId]: status }),
          { revalidate: false }
        );
      }
    };

    bc.addEventListener("message", handler);
    return () => bc.removeEventListener("message", handler);
  }, []);

  const getStatus = useCallback(
    (agentId: string): AgentStatus => {
      return statuses?.[agentId] ?? "idle";
    },
    [statuses]
  );

  return {
    statuses: statuses ?? {},
    getStatus,
    setThinking: setAgentThinking,
    setActive: setAgentActive,
    setIdle: setAgentIdle,
  };
}

// ============================================================================
// User Presence Hook
// ============================================================================

/**
 * Tracks user activity and sets active/idle status.
 * Call once at the app layout level — listens for mouse, keyboard,
 * scroll, and touch events. After 2 minutes of inactivity, sets idle.
 */
export function useUserPresence() {
  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let isActive = false;

    const setActive = () => {
      if (!isActive) {
        isActive = true;
        updateStatus(USER_STATUS_ID, "active");
      }
      // Reset idle timer on every interaction
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        isActive = false;
        updateStatus(USER_STATUS_ID, "idle");
      }, USER_IDLE_TIMEOUT_MS);
    };

    // Set active immediately on mount
    setActive();

    const events = ["mousemove", "keydown", "scroll", "click", "touchstart"] as const;
    for (const event of events) {
      document.addEventListener(event, setActive, { passive: true });
    }

    return () => {
      for (const event of events) {
        document.removeEventListener(event, setActive);
      }
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, []);
}
