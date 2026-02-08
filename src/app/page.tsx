"use client";

import { useRef, useState, useCallback } from "react";
import { Bot, Wifi, WifiOff, Crown, RefreshCw, Loader2, AlertCircle, Camera } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useOpenClaw, type OpenClawAgent } from "@/lib/hooks/use-openclaw";

function getInitials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function AgentCard({
  agent,
  isPrimary,
  isConnected,
  onAvatarUpdated,
}: {
  agent: OpenClawAgent;
  isPrimary: boolean;
  isConnected: boolean;
  onAvatarUpdated: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleAvatarClick = useCallback(() => {
    if (!isConnected) return;
    fileInputRef.current?.click();
  }, [isConnected]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset input so the same file can be selected again
      e.target.value = "";

      // Client-side validation
      if (file.size > 5 * 1024 * 1024) {
        alert("Image too large (max 5MB)");
        return;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("avatar", file);

        const resp = await fetch(`/api/openclaw/agents/${agent.id}/avatar`, {
          method: "POST",
          body: formData,
        });

        const result = await resp.json();
        if (!resp.ok) {
          alert(result.error || "Failed to update avatar");
          return;
        }

        // Gateway hot-reloads — just refresh agents to pick up new avatar
        onAvatarUpdated();
      } catch {
        alert("Failed to upload avatar");
      } finally {
        setUploading(false);
      }
    },
    [agent.id, onAvatarUpdated]
  );

  return (
    <Card
      variant="bordered"
      className={cn(
        "p-4 transition-colors",
        isConnected
          ? "hover:border-border-hover"
          : "opacity-60"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Clickable avatar with upload overlay */}
          <button
            type="button"
            onClick={handleAvatarClick}
            disabled={!isConnected || uploading}
            className="relative group rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title={isConnected ? "Click to change avatar" : undefined}
          >
            <Avatar size="md" status={isConnected ? "online" : "offline"}>
              {agent.avatar ? (
                <AvatarImage
                  src={agent.avatar}
                  alt={agent.name}
                  className={cn(!isConnected && "grayscale")}
                />
              ) : (
                <AvatarFallback>
                  {agent.emoji || getInitials(agent.name)}
                </AvatarFallback>
              )}
            </Avatar>
            {isConnected && !uploading && (
              <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera className="h-4 w-4 text-white" />
              </div>
            )}
            {uploading && (
              <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                <Loader2 className="h-4 w-4 text-white animate-spin" />
              </div>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
          />
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
              {isConnected
                ? (agent.description || "OpenClaw Agent")
                : "Unreachable"}
            </p>
          </div>
        </div>
        <Badge
          variant={isConnected ? "success" : "outline"}
          size="sm"
        >
          {isConnected ? "Active" : "Offline"}
        </Badge>
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
      if (serverVersion) parts[0] = `Connected to OpenClaw ${serverVersion}`;
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
                    isConnected={isConnected}
                    onAvatarUpdated={refresh}
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
