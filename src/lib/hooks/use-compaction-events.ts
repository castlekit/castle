"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { subscribe, type SSEEvent } from "@/lib/sse-singleton";

// ============================================================================
// Types
// ============================================================================

export interface CompactionEvent {
  phase: "start" | "end";
  willRetry?: boolean;
  timestamp: number;
}

interface UseCompactionEventsOptions {
  /** The session key to monitor. Null disables monitoring. */
  sessionKey: string | null;
  /** Callback fired when compaction completes (phase: "end"). */
  onCompactionComplete?: () => void;
}

interface UseCompactionEventsReturn {
  /** Whether a compaction is currently in progress. */
  isCompacting: boolean;
  /** The last compaction event received. */
  lastCompaction: CompactionEvent | null;
  /** Number of compactions observed in this session (since mount). */
  compactionCount: number;
  /** Whether to show the compaction banner (auto-dismissed after 8s). */
  showBanner: boolean;
  /** Manually dismiss the banner. */
  dismissBanner: () => void;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Subscribes to real-time compaction events from the Gateway via SSE singleton.
 *
 * Compaction events arrive as agent events with `stream: "compaction"`:
 *   { stream: "compaction", data: { phase: "start"|"end", willRetry?: boolean } }
 *
 * These are forwarded through the SSE system as events with type starting
 * with "agent." or as top-level events. We subscribe to "*" and filter.
 */
export function useCompactionEvents({
  sessionKey,
  onCompactionComplete,
}: UseCompactionEventsOptions): UseCompactionEventsReturn {
  const [isCompacting, setIsCompacting] = useState(false);
  const [lastCompaction, setLastCompaction] = useState<CompactionEvent | null>(null);
  const [compactionCount, setCompactionCount] = useState(0);
  const [showBanner, setShowBanner] = useState(false);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCompleteRef = useRef(onCompactionComplete);
  onCompleteRef.current = onCompactionComplete;

  useEffect(() => {
    if (!sessionKey) return;

    // Subscribe to all events and filter for compaction events.
    // Compaction events come through as agent events with stream: "compaction"
    const unsubscribe = subscribe("*", (evt: SSEEvent) => {
      // Check for compaction event payload
      const payload = evt.payload as Record<string, unknown> | undefined;
      if (!payload) return;

      // Compaction events can arrive in several shapes depending on Gateway version.
      // Look for stream === "compaction" in the payload
      const stream = payload.stream as string | undefined;
      if (stream !== "compaction") return;

      const data = (payload.data ?? payload) as {
        phase?: string;
        willRetry?: boolean;
      };

      const phase = data.phase as "start" | "end" | undefined;
      if (!phase) return;

      const compEvent: CompactionEvent = {
        phase,
        willRetry: data.willRetry,
        timestamp: Date.now(),
      };

      setLastCompaction(compEvent);

      if (phase === "start") {
        setIsCompacting(true);
      } else if (phase === "end") {
        setIsCompacting(false);
        setCompactionCount((c) => c + 1);

        // Show banner
        setShowBanner(true);
        if (bannerTimer.current) clearTimeout(bannerTimer.current);
        bannerTimer.current = setTimeout(() => setShowBanner(false), 8000);

        // Notify parent (e.g. to refresh session stats)
        onCompleteRef.current?.();
      }
    });

    return () => {
      unsubscribe();
      if (bannerTimer.current) {
        clearTimeout(bannerTimer.current);
        bannerTimer.current = null;
      }
    };
  }, [sessionKey]);

  const dismissBanner = useCallback(() => {
    setShowBanner(false);
    if (bannerTimer.current) {
      clearTimeout(bannerTimer.current);
      bannerTimer.current = null;
    }
  }, []);

  return {
    isCompacting,
    lastCompaction,
    compactionCount,
    showBanner,
    dismissBanner,
  };
}
