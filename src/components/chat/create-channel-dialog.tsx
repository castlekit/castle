"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ChevronDown } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useOpenClaw } from "@/lib/hooks/use-openclaw";
import type { Channel } from "@/lib/types/chat";

interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (channel: Channel) => void;
}

export function CreateChannelDialog({ open, onOpenChange, onCreated }: CreateChannelDialogProps) {
  const router = useRouter();
  const { agents } = useOpenClaw();
  const [name, setName] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [defaultAgentId, setDefaultAgentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Auto-select first agent when agents load
  if (agents.length > 0 && !defaultAgentId) {
    setDefaultAgentId(agents[0].id);
    setSelectedAgents([agents[0].id]);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !defaultAgentId) {
      setError("Please provide a name and select a default agent");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/openclaw/chat/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          defaultAgentId,
          agents: selectedAgents,
        }),
      });

      const data = await res.json();

      if (res.ok && data.channel) {
        onCreated?.(data.channel);
        router.push(`/chat/${data.channel.id}`);
        setName("");
        setSelectedAgents([]);
        setDefaultAgentId("");
        onOpenChange(false);
      } else {
        setError(data.error || "Failed to create channel");
      }
    } catch (err) {
      console.error("Failed to create channel:", err);
      setError("Failed to create channel");
    } finally {
      setLoading(false);
    }
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgents((prev) => {
      if (prev.includes(agentId)) {
        if (agentId === defaultAgentId) return prev;
        return prev.filter((id) => id !== agentId);
      }
      return [...prev, agentId];
    });
  };

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)}>
      <DialogHeader>
        <DialogTitle>Create Channel</DialogTitle>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Channel Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Project Discussion"
            autoFocus
          />
        </div>

        {/* Agent Selection */}
        <div>
          <label className="block text-sm font-medium mb-2">Agents</label>
          <div className="selectable-list max-h-48 overflow-y-auto">
            {agents.map((agent) => (
              <label
                key={agent.id}
                className="selectable-list-item"
              >
                <Checkbox
                  checked={selectedAgents.includes(agent.id)}
                  onCheckedChange={() => toggleAgent(agent.id)}
                />
                <span className="text-sm">{agent.name}</span>
                {defaultAgentId === agent.id && (
                  <span className="text-xs text-accent ml-auto">Default</span>
                )}
              </label>
            ))}
          </div>
        </div>

        {/* Default Agent */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Default Agent</label>
          <div className="relative">
            <select
              value={defaultAgentId}
              onChange={(e) => {
                setDefaultAgentId(e.target.value);
                if (!selectedAgents.includes(e.target.value)) {
                  setSelectedAgents((prev) => [...prev, e.target.value]);
                }
              }}
              className="input-base appearance-none pr-10 cursor-pointer"
            >
              <option value="">Select an agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-foreground-secondary pointer-events-none" />
          </div>
        </div>

        {/* Error */}
        {error && <p className="text-sm text-error">{error}</p>}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={loading || !name.trim() || !defaultAgentId}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Channel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
