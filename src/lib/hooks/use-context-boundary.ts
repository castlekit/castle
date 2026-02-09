"use client";

import { useCallback } from "react";
import useSWR from "swr";

// ============================================================================
// Types
// ============================================================================

interface ContextBoundaryData {
  boundaryMessageId: string | null;
  fresh: boolean;
}

interface UseContextBoundaryOptions {
  /** Gateway session key. Null disables fetching. */
  sessionKey: string | null;
  /** Channel ID for matching preview messages to local DB. */
  channelId: string;
}

interface UseContextBoundaryReturn {
  /** ID of the oldest message still in agent context. Null = no compaction yet or unknown. */
  boundaryMessageId: string | null;
  /** Whether data is loading. */
  isLoading: boolean;
  /** Re-fetch the boundary (call after compaction events). */
  refresh: () => void;
}

// ============================================================================
// Fetcher
// ============================================================================

const fetcher = async (url: string): Promise<ContextBoundaryData | null> => {
  const res = await fetch(url);
  if (res.status === 204) return null;
  if (!res.ok) return null;
  return res.json();
};

// ============================================================================
// Hook
// ============================================================================

/**
 * Fetches and caches the compaction context boundary for a session.
 *
 * Returns the ID of the oldest message the agent can still "see".
 * Messages before this boundary have been compacted (summarized).
 *
 * Polls infrequently (every 60s) since compaction events trigger explicit refreshes.
 */
export function useContextBoundary({
  sessionKey,
  channelId,
}: UseContextBoundaryOptions): UseContextBoundaryReturn {
  const swrKey = sessionKey
    ? `/api/openclaw/session/context?sessionKey=${encodeURIComponent(sessionKey)}&channelId=${encodeURIComponent(channelId)}`
    : null;

  const { data, isLoading, mutate } = useSWR<ContextBoundaryData | null>(
    swrKey,
    fetcher,
    {
      refreshInterval: 60000, // Refresh every 60s as background check
      dedupingInterval: 10000,
      revalidateOnFocus: false,
      errorRetryCount: 1,
    }
  );

  const refresh = useCallback(() => {
    mutate();
  }, [mutate]);

  return {
    boundaryMessageId: data?.boundaryMessageId ?? null,
    isLoading,
    refresh,
  };
}
