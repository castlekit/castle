"use client";

import { cn } from "@/lib/utils";

type AgentStatusType = "online" | "busy" | "idle" | "offline";

interface DisplayAgent {
  id: string;
  name: string;
  role: string;
  status: AgentStatusType;
  avatar?: string;
}

export interface AgentStatusWidgetProps {
  variant?: "solid" | "glass";
  agents?: DisplayAgent[];
  className?: string;
}

const statusColors: Record<AgentStatusType, string> = {
  online: "bg-success",
  busy: "bg-warning",
  idle: "bg-info",
  offline: "bg-foreground-muted",
};

const statusLabels: Record<AgentStatusType, string> = {
  online: "Active",
  busy: "Working",
  idle: "Idle",
  offline: "Offline",
};

const defaultAgents: DisplayAgent[] = [
  { id: "1", name: "Atlas", role: "Executive Assistant", status: "online" },
  { id: "2", name: "Mason", role: "Full-Stack Developer", status: "busy" },
  { id: "3", name: "Sage", role: "Research Analyst", status: "online" },
  { id: "4", name: "Max", role: "Data Engineer", status: "idle" },
  { id: "5", name: "Merlin", role: "Creative Director", status: "offline" },
];

function AgentStatusWidget({
  variant = "solid",
  agents = defaultAgents,
  className,
}: AgentStatusWidgetProps) {
  const onlineCount = agents.filter(
    (a) => a.status === "online" || a.status === "busy"
  ).length;

  return (
    <div className={cn(
      "rounded-[var(--radius-lg)] p-6",
      variant === "glass" ? "glass" : "bg-surface border border-border",
      className
    )}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-foreground">Agents</h3>
        <span className="text-xs text-foreground-secondary">
          {onlineCount} active
        </span>
      </div>
      <div className="space-y-3">
        {agents.map((agent) => (
          <div key={agent.id} className="flex items-center gap-3">
            <div className="relative">
              <div className="h-8 w-8 rounded-[var(--radius-full)] bg-surface flex items-center justify-center text-sm font-medium text-foreground-secondary border border-border">
                {agent.name[0]}
              </div>
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-[var(--radius-full)] ring-2 ring-background",
                  statusColors[agent.status]
                )}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {agent.name}
              </p>
              <p className="text-xs text-foreground-muted truncate">
                {agent.role}
              </p>
            </div>
            <span
              className={cn(
                "text-xs px-2 py-0.5 rounded-[var(--radius-full)]",
                {
                  "bg-success/10 text-success": agent.status === "online",
                  "bg-warning/10 text-warning": agent.status === "busy",
                  "bg-info/10 text-info": agent.status === "idle",
                  "bg-foreground-muted/10 text-foreground-muted":
                    agent.status === "offline",
                }
              )}
            >
              {statusLabels[agent.status]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { AgentStatusWidget };
