"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, MessageCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CreateChannelDialog } from "./create-channel-dialog";
import type { Channel } from "@/lib/types/chat";

interface ChannelListProps {
  activeChannelId?: string;
  className?: string;
}

export function ChannelList({ activeChannelId, className }: ChannelListProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

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

  const handleChannelCreated = (channel: Channel) => {
    setChannels((prev) => [channel, ...prev]);
    setShowCreate(false);
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground-secondary">Channels</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setShowCreate(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

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
        <div className="space-y-1">
          {channels.map((channel) => (
            <Link
              key={channel.id}
              href={`/chat/${channel.id}`}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                activeChannelId === channel.id
                  ? "bg-accent/10 text-accent"
                  : "hover:bg-surface-hover text-foreground"
              )}
            >
              <MessageCircle className="h-4 w-4 shrink-0" />
              <span className="truncate text-sm">{channel.name}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <CreateChannelDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={handleChannelCreated}
      />
    </div>
  );
}
