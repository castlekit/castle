"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw, Trash2, Hash, MessageCircle } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatTimeAgo } from "@/lib/date-utils";
import type { Channel } from "@/lib/types/chat";

interface ArchivedChannelsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored?: (channel: Channel) => void;
}

export function ArchivedChannels({
  open,
  onOpenChange,
  onRestored,
}: ArchivedChannelsProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchArchived = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/openclaw/chat/channels?archived=1");
      if (res.ok) {
        const data = await res.json();
        setChannels(data.channels || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchArchived();
      setConfirmDelete(null);
    }
  }, [open]);

  const handleRestore = async (channel: Channel) => {
    setActionLoading(channel.id);
    try {
      const res = await fetch("/api/openclaw/chat/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", id: channel.id }),
      });
      if (res.ok) {
        setChannels((prev) => prev.filter((c) => c.id !== channel.id));
        onRestored?.(channel);
      }
    } catch {
      // silent
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch("/api/openclaw/chat/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      if (res.ok) {
        setChannels((prev) => prev.filter((c) => c.id !== id));
        setConfirmDelete(null);
      }
    } catch {
      // silent
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Archived Channels</DialogTitle>
      </DialogHeader>

      <div className="min-h-[200px]">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-foreground-secondary" />
          </div>
        ) : channels.length === 0 ? (
          <div className="text-center py-12 text-foreground-secondary">
            <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No archived channels</p>
          </div>
        ) : (
          <div className="space-y-3">
            {channels.map((channel) => (
              <div
                key={channel.id}
                className="flex items-center justify-between px-3 py-2.5 rounded-[var(--radius-sm)] bg-surface-hover/50 hover:bg-surface-hover group"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Hash className="h-4 w-4 shrink-0 text-foreground-secondary" strokeWidth={2.5} />
                  <div className="min-w-0">
                    <span className="text-sm text-foreground truncate block">
                      {channel.name}
                    </span>
                    <span className="text-xs text-foreground-secondary">
                      Created {formatDateTime(new Date(channel.createdAt).getTime())}
                      {channel.archivedAt && (
                        <> · Archived {formatTimeAgo(new Date(channel.archivedAt).getTime())}</>
                      )}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {confirmDelete === channel.id ? (
                    <>
                      <span className="text-xs text-red-400 mr-1">
                        Delete forever?
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 px-2 text-xs"
                        onClick={() => handleDelete(channel.id)}
                        disabled={actionLoading === channel.id}
                      >
                        {actionLoading === channel.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Yes"
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setConfirmDelete(null)}
                      >
                        No
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-foreground-secondary hover:text-foreground"
                        onClick={() => handleRestore(channel)}
                        disabled={actionLoading === channel.id}
                        title="Restore channel"
                      >
                        {actionLoading === channel.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-foreground-secondary hover:text-red-400"
                        onClick={() => setConfirmDelete(channel.id)}
                        title="Delete permanently"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
