"use client";

import { Bot, Wifi, WifiOff, Crown } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { UserMenu } from "@/components/layout/user-menu";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

// Placeholder data until OpenClaw integration is wired up
const mockAgents = [
  { id: "1", name: "assistant", status: "active" as const, isPrimary: true },
  { id: "2", name: "research", status: "active" as const, isPrimary: false },
  { id: "3", name: "writer", status: "idle" as const, isPrimary: false },
];

function getStatusBadge(status: "active" | "idle" | "error" | "offline") {
  switch (status) {
    case "active":
      return <Badge variant="success" size="sm">Active</Badge>;
    case "idle":
      return <Badge variant="warning" size="sm">Idle</Badge>;
    case "error":
      return <Badge variant="error" size="sm">Error</Badge>;
    case "offline":
      return <Badge variant="outline" size="sm">Offline</Badge>;
  }
}

function getInitials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

export default function HomePage() {
  const isConnected = true; // Will be dynamic with OpenClaw integration

  return (
    <div className="min-h-screen bg-background">
      <Sidebar variant="solid" />
      <UserMenu className="fixed top-5 right-6 z-50" variant="solid" />

      <main className="min-h-screen ml-[80px]">
        <div className="p-8 max-w-4xl">
          {/* Header */}
          <div className="mb-8">
            <PageHeader
              title="Castle"
              subtitle="Your AI agent command center"
            />
          </div>

          {/* OpenClaw Connection Status */}
          <Card variant="bordered" className="mb-8">
            <CardContent className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isConnected ? (
                  <Wifi className="h-5 w-5 text-success" />
                ) : (
                  <WifiOff className="h-5 w-5 text-error" />
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    OpenClaw Gateway
                  </p>
                  <p className="text-xs text-foreground-muted">
                    {isConnected
                      ? "Connected at ws://127.0.0.1:18789"
                      : "Not connected"}
                  </p>
                </div>
              </div>
              <Badge variant={isConnected ? "success" : "error"}>
                {isConnected ? "Connected" : "Disconnected"}
              </Badge>
            </CardContent>
          </Card>

          {/* Agents */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Bot className="h-5 w-5 text-foreground-secondary" />
                Agents
              </h2>
              <span className="text-sm text-foreground-muted">
                {mockAgents.length} agents discovered
              </span>
            </div>

            <div className="grid gap-3">
              {mockAgents.map((agent) => (
                <Card
                  key={agent.id}
                  variant="bordered"
                  className="p-4 hover:border-border-hover transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar
                        size="md"
                        status={
                          agent.status === "active"
                            ? "online"
                            : agent.status === "idle"
                            ? "away"
                            : "offline"
                        }
                      >
                        <AvatarFallback>{getInitials(agent.name)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {agent.name}
                          </p>
                          {agent.isPrimary && (
                            <span className="flex items-center gap-1 text-xs text-accent">
                              <Crown className="h-3 w-3" />
                              Primary
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-foreground-muted">
                          OpenClaw Agent
                        </p>
                      </div>
                    </div>
                    {getStatusBadge(agent.status)}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
