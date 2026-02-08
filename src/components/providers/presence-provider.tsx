"use client";

import { useUserPresence } from "@/lib/hooks/use-agent-status";

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  useUserPresence();
  return <>{children}</>;
}
