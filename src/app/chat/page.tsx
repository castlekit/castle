"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Loader2 } from "lucide-react";

export default function ChatPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Ask the DB for the last accessed channel
    fetch("/api/openclaw/chat/channels?last=1")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.channelId) {
          router.replace(`/chat/${data.channelId}`);
          return;
        }
        // No last accessed — try the most recent channel
        return fetch("/api/openclaw/chat/channels")
          .then((res) => (res.ok ? res.json() : null))
          .then((chData) => {
            const channels = chData?.channels;
            if (channels && channels.length > 0) {
              router.replace(`/chat/${channels[0].id}`);
            } else {
              setChecking(false);
            }
          });
      })
      .catch(() => setChecking(false));
  }, [router]);

  if (checking) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-foreground-secondary" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-3">
        <MessageCircle className="h-12 w-12 mx-auto text-foreground-secondary/30" />
        <div>
          <h2 className="text-lg font-semibold text-foreground">Welcome to Chat</h2>
          <p className="text-sm text-foreground-secondary mt-1">
            Select a channel from the sidebar or create a new one to start chatting.
          </p>
        </div>
      </div>
    </div>
  );
}
