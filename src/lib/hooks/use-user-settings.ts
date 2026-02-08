"use client";

import useSWR from "swr";

const SETTINGS_KEY = "/api/settings";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface UserSettings {
  displayName?: string;
  avatarPath?: string;
  tooltips?: string;
}

/**
 * Shared hook for user settings (display name, avatar, etc).
 *
 * All consumers share the same SWR cache. Call `refresh()` after
 * updating settings to instantly propagate changes everywhere
 * (user menu, chat headers, message avatars).
 */
export function useUserSettings() {
  const { data, mutate, isLoading } = useSWR<UserSettings>(
    SETTINGS_KEY,
    fetcher,
    {
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  );

  const displayName = data?.displayName || "";
  const avatarUrl = data?.avatarPath
    ? `/api/settings/avatar?v=${encodeURIComponent(data.avatarPath)}`
    : null;
  const tooltips = data?.tooltips !== "false"; // default true

  return {
    displayName,
    avatarUrl,
    tooltips,
    isLoading,
    /** Call after saving settings to refresh all consumers */
    refresh: () => mutate(),
  };
}
