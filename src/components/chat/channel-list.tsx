"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Channel } from "@/lib/types/chat";

interface ChannelListProps {
  activeChannelId?: string;
  className?: string;
  showCreateDialog?: boolean;
  onCreateDialogChange?: (open: boolean) => void;
}

export function ChannelList({
  activeChannelId,
  className,
  onCreateDialogChange,
}: ChannelListProps) {
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
  }, []);

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
          <p className="text-sm">No channels yet</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setShowCreate(true)}
          >
            Create your first channel
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
                "selectable-list-item transition-colors",
                activeChannelId === channel.id
                  ? "bg-accent/10 text-accent"
                  : "text-foreground"
              )}
            >
              <MessageCircle className="h-4 w-4 shrink-0" />
              <span className="truncate">{channel.name}</span>
            </Link>
          ))}
        </div>
      )}

    </div>
  );
}
