"use client";

import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

export interface AgentInfo {
  id: string;
  name: string;
  avatar?: string | null;
}

interface AgentMentionPopupProps {
  agents: AgentInfo[];
  filter: string;
  onSelect: (agentId: string) => void;
  onClose: () => void;
  highlightedIndex?: number;
}

export function AgentMentionPopup({ agents, filter, onSelect, onClose, highlightedIndex = 0 }: AgentMentionPopupProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const filteredAgents = getFilteredAgents(agents, filter);

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current && highlightedIndex >= 0) {
      const items = listRef.current.querySelectorAll("button");
      const item = items[highlightedIndex];
      if (item) {
        item.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex]);

  if (filteredAgents.length === 0) {
    return null;
  }

  return (
    <div className="absolute bottom-full left-0 mb-2 w-64 bg-surface border border-border rounded-xl shadow-lg overflow-hidden z-50">
      <div className="p-2" ref={listRef}>
        <p className="text-xs text-foreground-secondary px-2 py-1 mb-1">
          Mention an agent (Up/Down to navigate, Tab/Enter to select)
        </p>
        {filteredAgents.map((agent, index) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => onSelect(agent.id)}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm",
              "hover:bg-accent/80 hover:text-white focus:outline-none",
              index === highlightedIndex
                ? "bg-accent text-white"
                : "text-foreground"
            )}
          >
            {agent.avatar ? (
              <img
                src={agent.avatar}
                alt={agent.name}
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <div className={cn(
                "flex items-center justify-center w-6 h-6 rounded-full",
                index === highlightedIndex
                  ? "bg-white/20 text-white"
                  : "bg-accent/20 text-accent"
              )}>
                <Bot className="w-3 h-3" />
              </div>
            )}
            <span className="font-medium">{agent.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Filter agents by name match */
export function getFilteredAgents(agents: AgentInfo[], filter: string): AgentInfo[] {
  return agents.filter(agent =>
    agent.name.toLowerCase().includes(filter.toLowerCase())
  );
}
