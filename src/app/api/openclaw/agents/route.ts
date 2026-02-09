import { NextResponse } from "next/server";
import { ensureGateway } from "@/lib/gateway-connection";

export const dynamic = "force-dynamic";

interface AgentIdentity {
  name?: string;
  theme?: string;
  emoji?: string;
  avatar?: string;
  avatarUrl?: string;
}

interface GatewayAgent {
  id: string;
  name?: string;
  identity?: AgentIdentity;
}

interface AgentsListPayload {
  defaultId?: string;
  mainKey?: string;
  scope?: string;
  agents: GatewayAgent[];
}

interface AgentConfig {
  id: string;
  workspace?: string;
}

interface ConfigGetPayload {
  hash: string;
  parsed: {
    agents?: {
      list?: AgentConfig[];
    };
  };
}

/** Avatar URL patterns containing a hash */
const AVATAR_HASH_PATTERNS = [
  /\/api\/v\d+\/avatars\/([a-f0-9]+)/i,
  /\/avatars\/([a-f0-9]+)/i,
];

/**
 * Resolve an avatar value into a Castle-proxied URL.
 *
 * Handles three formats:
 *   1. Data URI       → pass through (self-contained)
 *   2. HTTP(S) URL    → proxy via /api/avatars/:key
 *   3. Relative path  → proxy via /api/avatars/:key (resolved server-side against workspace)
 */
function resolveAvatarUrl(
  avatar: string | null,
  agentId: string,
  workspace: string | undefined,
  gw: ReturnType<typeof ensureGateway>,
): string | null {
  if (!avatar) return null;

  // Data URIs are self-contained
  if (avatar.startsWith("data:")) return avatar;

  // HTTP(S) URL — proxy through Castle
  if (avatar.startsWith("http://") || avatar.startsWith("https://")) {
    // Try to extract a hash for a cleaner key
    for (const pattern of AVATAR_HASH_PATTERNS) {
      const match = avatar.match(pattern);
      if (match) {
        gw.setAvatarUrl(match[1], avatar);
        return `/api/avatars/${match[1]}`;
      }
    }
    // No hash — use agent ID as key
    const key = `agent-${agentId}`;
    gw.setAvatarUrl(key, avatar);
    return `/api/avatars/${key}`;
  }

  // Relative path (e.g. "avatars/sam.png") — resolve against workspace
  if (workspace && !avatar.startsWith("/")) {
    const key = `agent-${agentId}`;
    gw.setAvatarUrl(key, `workspace://${workspace}/${avatar}`);
    return `/api/avatars/${key}`;
  }

  return null;
}

/**
 * GET /api/openclaw/agents
 * Discover agents from OpenClaw Gateway via agents.list,
 * with workspace info from config.get for avatar resolution.
 */
export async function GET() {
  const gw = ensureGateway();

  if (!gw.isConnected) {
    return NextResponse.json(
      { error: "Gateway not connected", state: gw.state, agents: [] },
      { status: 503 }
    );
  }

  try {
    const _start = Date.now();
    // Fetch agents and config in parallel
    const [agentsResult, configResult] = await Promise.all([
      gw.request<AgentsListPayload>("agents.list", {}),
      gw.request<ConfigGetPayload>("config.get", {}).catch((err) => {
        console.warn("[Agents API] config.get failed (non-fatal):", (err as Error).message);
        return null;
      }),
    ]);

    // Build workspace lookup from config
    const workspaceMap = new Map<string, string>();
    if (configResult?.parsed?.agents?.list) {
      for (const a of configResult.parsed.agents.list) {
        if (a.workspace) workspaceMap.set(a.id, a.workspace);
      }
    }

    const agents = (agentsResult?.agents || []).map((agent: GatewayAgent) => {
      const name = agent.identity?.name || agent.name || agent.id;
      const rawAvatar = agent.identity?.avatarUrl || agent.identity?.avatar || null;
      const emoji = agent.identity?.emoji || null;
      const description = agent.identity?.theme || null;
      const workspace = workspaceMap.get(agent.id);
      const avatar = resolveAvatarUrl(rawAvatar, agent.id, workspace, gw);

      return { id: agent.id, name, description, avatar, emoji };
    });

    console.log(`[Agents API] GET list OK — ${agents.length} agents (${Date.now() - _start}ms)`);
    return NextResponse.json({
      agents,
      defaultId: agentsResult?.defaultId,
    });
  } catch (err) {
    console.error("[Agents API] GET list FAILED:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list agents", agents: [] },
      { status: 500 }
    );
  }
}
