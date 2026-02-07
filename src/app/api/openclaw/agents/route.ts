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

/**
 * Rewrite avatar URLs to local /api/avatars/ endpoint.
 * Handles URLs like "http://localhost:8787/api/v1/avatars/HASH" -> "/api/avatars/HASH"
 */
function rewriteAvatarUrl(url: string | null): string | null {
  if (!url) return null;

  // Extract hash from known avatar URL patterns
  const patterns = [
    /\/api\/v\d+\/avatars\/([a-f0-9]+)/i,
    /\/avatars\/([a-f0-9]+)/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return `/api/avatars/${match[1]}`;
    }
  }

  // If it's already a relative path or data URI, pass through
  if (url.startsWith("/") || url.startsWith("data:")) {
    return url;
  }

  // Only allow http/https URLs through; reject file:, javascript:, etc.
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  return null;
}

/**
 * GET /api/openclaw/agents
 * Discover agents from OpenClaw Gateway via agents.list
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
    const result = await gw.request<AgentsListPayload>("agents.list", {});

    const agents = (result?.agents || []).map((agent: GatewayAgent) => {
      const name =
        agent.identity?.name || agent.name || agent.id;
      const rawAvatar =
        agent.identity?.avatarUrl || agent.identity?.avatar || null;
      const emoji = agent.identity?.emoji || null;
      const description = agent.identity?.theme || null;

      // Rewrite external avatar URLs to our local /api/avatars/ endpoint
      const avatar = rewriteAvatarUrl(rawAvatar);

      return {
        id: agent.id,
        name,
        description,
        avatar,
        emoji,
      };
    });

    return NextResponse.json({
      agents,
      defaultId: result?.defaultId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list agents", agents: [] },
      { status: 500 }
    );
  }
}
