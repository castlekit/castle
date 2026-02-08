"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { UserMenu } from "@/components/layout/user-menu";
import { ChannelList } from "@/components/chat/channel-list";
import { StorageIndicator } from "@/components/chat/storage-indicator";
import { useParams } from "next/navigation";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const channelId = params?.channelId as string | undefined;

  return (
    <div className="h-screen overflow-hidden bg-background">
      <Sidebar variant="solid" />
      <UserMenu className="fixed top-5 right-6 z-50" variant="solid" />

      <div className="h-screen ml-[80px] flex">
        {/* Channel sidebar — fixed, scrolls independently */}
        <div className="w-[260px] border-r border-border flex flex-col bg-surface/50 shrink-0">
          <div className="p-4 border-b border-border shrink-0">
            <h2 className="text-sm font-semibold text-foreground">Chat</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <ChannelList activeChannelId={channelId} />
          </div>
          <div className="shrink-0">
            <StorageIndicator />
          </div>
        </div>

        {/* Main content — fills remaining space, children handle internal scroll */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
