"use client";

import { useState } from "react";
import { Plus, Archive } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";

import { ChannelList } from "@/components/chat/channel-list";
import { ArchivedChannels } from "@/components/chat/archived-channels";
import { CreateChannelDialog } from "@/components/chat/create-channel-dialog";
import { useParams, useRouter } from "next/navigation";
import type { Channel } from "@/lib/types/chat";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const router = useRouter();
  const channelId = params?.channelId as string | undefined;
  const [showCreate, setShowCreate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [newChannel, setNewChannel] = useState<Channel | null>(null);

  const handleChannelCreated = (channel: Channel) => {
    setNewChannel(channel);
    setShowCreate(false);
    router.push(`/chat/${channel.id}`);
  };

  return (
    <div className="h-screen overflow-hidden bg-background">
      <Sidebar variant="solid" />

      <div className="h-screen ml-[80px] flex py-[20px]">
        {/* Channel sidebar — floating glass panel, aligned with sidebar pill */}
        <div className="w-[290px] shrink-0 px-[25px]">
          <div className="h-full panel flex flex-col">
            <div className="pl-4 pr-3 py-3 flex items-center justify-between shrink-0 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">
                Channels
              </h2>
              <button
                onClick={() => setShowCreate(true)}
                title="New channel"
                className="flex items-center justify-center h-7 w-7 rounded-[var(--radius-sm)] bg-accent text-white hover:bg-accent/90 transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4 stroke-[2.5]" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <ChannelList
                activeChannelId={channelId}
                showCreateDialog={showCreate}
                onCreateDialogChange={setShowCreate}
                newChannel={newChannel}
              />
            </div>
            <div className="shrink-0 px-3 pb-3">
              <button
                onClick={() => setShowArchived(true)}
                className="flex items-center justify-center gap-2 w-full px-2 py-2 text-xs text-foreground-secondary hover:text-foreground transition-colors cursor-pointer rounded-lg hover:bg-surface-hover"
              >
                <Archive className="h-3.5 w-3.5" />
                Archived channels
              </button>
            </div>
          </div>
        </div>

        {/* Main content — fills remaining space, aligned with floating boxes */}
        <div className="flex-1 min-w-0 h-full overflow-hidden pr-[20px] flex flex-col">
          {children}
        </div>
      </div>

      {/* Create channel dialog — rendered at layout root, outside glass panel */}
      <CreateChannelDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={handleChannelCreated}
      />

      {/* Archived channels dialog */}
      <ArchivedChannels
        open={showArchived}
        onOpenChange={setShowArchived}
        onRestored={(channel) => {
          setNewChannel(channel);
          setShowArchived(false);
          router.push(`/chat/${channel.id}`);
        }}
      />
    </div>
  );
}
