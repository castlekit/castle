/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Agent Status (non-hook utilities)", () => {
  beforeEach(() => {
    vi.resetModules();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    // Mock BroadcastChannel (not available in jsdom)
    vi.stubGlobal("BroadcastChannel", class {
      postMessage = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      close = vi.fn();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("should track thinking channel", async () => {
    const { setAgentThinking, getThinkingChannel, setAgentIdle } = await import("../use-agent-status");

    setAgentThinking("agent-1", "channel-abc");
    expect(getThinkingChannel("agent-1")).toBe("channel-abc");

    setAgentIdle("agent-1");
    expect(getThinkingChannel("agent-1")).toBeUndefined();
  });

  it("setAgentThinking should call fetch with thinking status", async () => {
    const { setAgentThinking } = await import("../use-agent-status");

    setAgentThinking("agent-2");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/openclaw/agents/status",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ agentId: "agent-2", status: "thinking" }),
      })
    );
  });

  it("setAgentActive should persist active status and schedule idle", async () => {
    const { setAgentActive } = await import("../use-agent-status");

    setAgentActive("agent-3");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/openclaw/agents/status",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ agentId: "agent-3", status: "active" }),
      })
    );
  });

  it("setAgentIdle should clear thinking channel and persist idle", async () => {
    const { setAgentThinking, setAgentIdle, getThinkingChannel } = await import("../use-agent-status");

    setAgentThinking("agent-4", "ch-1");
    expect(getThinkingChannel("agent-4")).toBe("ch-1");

    setAgentIdle("agent-4");
    expect(getThinkingChannel("agent-4")).toBeUndefined();

    expect(global.fetch).toHaveBeenLastCalledWith(
      "/api/openclaw/agents/status",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ agentId: "agent-4", status: "idle" }),
      })
    );
  });

  it("USER_STATUS_ID constant should be defined", async () => {
    const { USER_STATUS_ID } = await import("../use-agent-status");
    expect(USER_STATUS_ID).toBe("__user__");
  });
});
