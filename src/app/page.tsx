"use client";

import { Bot, Wifi, WifiOff, Crown, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { UserMenu } from "@/components/layout/user-menu";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useOpenClaw, type OpenClawAgent } from "@/lib/hooks/use-openclaw";

function getInitials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function AgentCard({ agent, isPrimary }: { agent: OpenClawAgent; isPrimary: boolean }) {
  return (
    <Card
      variant="bordered"
      className="p-4 hover:border-border-hover transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar size="md" status="online">
            {agent.avatar ? (
              <AvatarImage src={agent.avatar} alt={agent.name} />
            ) : (
              <AvatarFallback>
                {agent.emoji || getInitials(agent.name)}
              </AvatarFallback>
            )}
          </Avatar>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground">
                {agent.name}
              </p>
              {isPrimary && (
                <span className="flex items-center gap-1 text-xs text-accent">
                  <Crown className="h-3 w-3" />
                  Primary
                </span>
              )}
            </div>
            <p className="text-xs text-foreground-muted">
              {agent.description || "OpenClaw Agent"}
            </p>
          </div>
        </div>
        <Badge variant="success" size="sm">Active</Badge>
      </div>
    </Card>
  );
}

function ConnectionCard({
  isConnected,
  isLoading,
  isConfigured,
  serverVersion,
  latency,
  error,
  onRefresh,
}: {
  isConnected: boolean;
  isLoading: boolean;
  isConfigured: boolean;
  serverVersion?: string;
  latency?: number;
  error?: string;
  onRefresh: () => void;
}) {
  const getSubtitle = () => {
    if (isLoading) return "Connecting to Gateway...";
    if (!isConfigured) return "Run 'castle setup' to configure";
    if (isConnected) {
      const parts = ["Connected"];
      if (serverVersion) parts[0] = `Connected to OpenClaw v${serverVersion}`;
      if (latency) parts.push(`${latency}ms`);
      return parts.join(" · ");
    }
    return error || "Not connected";
  };

  return (
    <Card variant="bordered" className="mb-8">
      <CardContent className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isLoading ? (
            <Loader2 className="h-5 w-5 text-foreground-muted animate-spin" />
          ) : isConnected ? (
            <Wifi className="h-5 w-5 text-success" />
          ) : (
            <WifiOff className="h-5 w-5 text-error" />
          )}
          <div>
            <p className="text-sm font-medium text-foreground">
              OpenClaw Gateway
            </p>
            <p className="text-xs text-foreground-muted">
              {getSubtitle()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors"
            title="Refresh connection"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          {isLoading ? (
            <Badge variant="outline">Connecting...</Badge>
          ) : (
            <Badge variant={isConnected ? "success" : "error"}>
              {isConnected ? "Connected" : "Disconnected"}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AgentsSkeleton() {
  return (
    <div className="grid gap-3">
      {[1, 2, 3].map((i) => (
        <Card key={i} variant="bordered" className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-surface-hover animate-pulse" />
            <div className="space-y-2">
              <div className="h-4 w-24 bg-surface-hover rounded animate-pulse" />
              <div className="h-3 w-32 bg-surface-hover rounded animate-pulse" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function EmptyState({ isConfigured }: { isConfigured: boolean }) {
  return (
    <Card variant="bordered" className="p-8">
      <div className="flex flex-col items-center text-center gap-3">
        {isConfigured ? (
          <>
            <AlertCircle className="h-8 w-8 text-foreground-muted" />
            <div>
              <p className="text-sm font-medium text-foreground">
                No agents discovered
              </p>
              <p className="text-xs text-foreground-muted mt-1">
                Make sure OpenClaw Gateway is running and agents are configured.
              </p>
            </div>
          </>
        ) : (
          <>
            <Bot className="h-8 w-8 text-foreground-muted" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Welcome to Castle
              </p>
              <p className="text-xs text-foreground-muted mt-1">
                Run <code className="px-1 py-0.5 bg-surface-hover rounded text-xs">castle setup</code> to connect to your OpenClaw Gateway.
              </p>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

export default function HomePage() {
  const {
    status,
    isLoading,
    isConnected,
    isConfigured,
    latency,
    serverVersion,
    agents,
    agentsLoading,
    refresh,
  } = useOpenClaw();

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
              subtitle="The multi-agent workspace"
            />
          </div>

          {/* OpenClaw Connection Status */}
          <ConnectionCard
            isConnected={isConnected}
            isLoading={isLoading}
            isConfigured={isConfigured}
            serverVersion={serverVersion}
            latency={latency}
            error={status?.error}
            onRefresh={refresh}
          />

          {/* Agents */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Bot className="h-5 w-5 text-foreground-secondary" />
                Agents
              </h2>
              {!isLoading && agents.length > 0 && (
                <span className="text-sm text-foreground-muted">
                  {agents.length} agent{agents.length !== 1 ? "s" : ""} discovered
                </span>
              )}
            </div>

            {agentsLoading && isLoading ? (
              <AgentsSkeleton />
            ) : agents.length > 0 ? (
              <div className="grid gap-3">
                {agents.map((agent, idx) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    isPrimary={idx === 0}
                  />
                ))}
              </div>
            ) : (
              <EmptyState isConfigured={isConfigured} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
