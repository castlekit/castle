"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, Loader2, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Channel } from "@/lib/types/chat";

interface ChannelListProps {
  activeChannelId?: string;
  className?: string;
  showCreateDialog?: boolean;
  onCreateDialogChange?: (open: boolean) => void;
  newChannel?: Channel | null;
}

export function ChannelList({
  activeChannelId,
  className,
  onCreateDialogChange,
  newChannel,
}: ChannelListProps) {
  const router = useRouter();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  const setShowCreate = onCreateDialogChange ?? (() => {});

  const fetchChannels = async () => {
    try {
      const res = await fetch("/api/openclaw/chat/channels");
      if (res.ok) {
        const data = await res.json();
        setChannels(data.channels || []);
      }
    } catch (error) {
      console.error("Failed to fetch channels:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChannels();
  }, []); // Only fetch once on mount — channel list doesn't change on navigation

  // Instantly add a newly created channel to the list
  useEffect(() => {
    if (newChannel && !channels.some((c) => c.id === newChannel.id)) {
      setChannels((prev) => [newChannel, ...prev]);
    }
  }, [newChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-foreground-secondary" />
        </div>
      )}

      {/* Empty state */}
      {!loading && channels.length === 0 && (
        <div className="text-center py-8 text-foreground-secondary">
          <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No active channels</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setShowCreate(true)}
          >
            New channel
          </Button>
        </div>
      )}

      {/* Channel list */}
      {!loading && channels.length > 0 && (
        <div className="selectable-list">
          {channels.map((channel) => (
            <Link
              key={channel.id}
              href={`/chat/${channel.id}`}
              className={cn(
                "selectable-list-item transition-colors group relative flex items-center gap-2.5",
                activeChannelId === channel.id
                  ? "bg-accent/10 text-accent"
                  : "text-foreground"
              )}
            >
              <MessageCircle className="h-4 w-4 shrink-0" />
              <span className="truncate flex-1 min-w-0">{channel.name}</span>
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    const res = await fetch("/api/openclaw/chat/channels", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "archive", id: channel.id }),
                    });
                    if (res.ok) {
                      setChannels((prev) => prev.filter((c) => c.id !== channel.id));
                      if (activeChannelId === channel.id) {
                        const remaining = channels.filter((c) => c.id !== channel.id);
                        if (remaining.length > 0) {
                          router.push(`/chat/${remaining[0].id}`);
                        } else {
                          router.push("/chat");
                        }
                      }
                    }
                  } catch {
                    // silent
                  }
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-hover text-foreground-secondary hover:text-foreground cursor-pointer"
                title="Archive channel"
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
            </Link>
          ))}
        </div>
      )}

    </div>
  );
}
