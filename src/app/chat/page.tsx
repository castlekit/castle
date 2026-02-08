"use client";

import { MessageCircle } from "lucide-react";

export default function ChatPage() {
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
