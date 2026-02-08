"use client";

import { useCallback } from "react";
import useSWR from "swr";
import type { SessionStatus } from "@/lib/types/chat";

const fetcher = async (url: string): Promise<SessionStatus | null> => {
  const res = await fetch(url);
  if (res.status === 204) return null;
  if (!res.ok) throw new Error("Failed to fetch session stats");
  return res.json();
};

interface UseSessionStatsOptions {
  sessionKey: string | null;
}

interface UseSessionStatsReturn {
  stats: SessionStatus | null;
  isLoading: boolean;
  isError: boolean;
  refresh: () => void;
}

/**
 * SWR-based hook for fetching session statistics from the Gateway.
 * Conditional fetching: only when sessionKey is non-null.
 * Polls every 30s while active, dedupes within 5s.
 */
export function useSessionStats({ sessionKey }: UseSessionStatsOptions): UseSessionStatsReturn {
  const {
    data,
    isLoading,
    error,
    mutate,
  } = useSWR<SessionStatus | null>(
    sessionKey ? `/api/openclaw/session/status?sessionKey=${sessionKey}` : null,
    fetcher,
    {
      refreshInterval: 30000,
      dedupingInterval: 5000,
      revalidateOnFocus: false,
      errorRetryCount: 1,
    }
  );

  const refresh = useCallback(() => {
    mutate();
  }, [mutate]);

  return {
    stats: data ?? null,
    isLoading,
    isError: !!error,
    refresh,
  };
}
