import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getOpenClawDir } from "@/lib/config";
import { sanitizeForApi } from "@/lib/api-security";
import type { SessionStatus } from "@/lib/types/chat";
import JSON5 from "json5";

// ============================================================================
// GET /api/openclaw/session/status?sessionKey=X — Real session stats
//
// Reads directly from the OpenClaw session store on the filesystem.
// This is the source of truth — the same data the Gateway uses.
// ============================================================================

export const dynamic = "force-dynamic";

/**
 * OpenClaw's default context window when nothing is configured.
 * Matches DEFAULT_CONTEXT_TOKENS in the Gateway source (2e5 = 200,000).
 */
const OPENCLAW_DEFAULT_CONTEXT_TOKENS = 200_000;

/**
 * Parse a session key like "agent:main:castle:2d16fadb-..." to extract the agent ID.
 * Format: agent:<agentId>:<channel>:<channelId>
 */
function parseAgentId(sessionKey: string): string | null {
  const parts = sessionKey.split(":");
  // agent:<agentId>:...
  if (parts[0] === "agent" && parts.length >= 2) {
    return parts[1];
  }
  return null;
}

/**
 * Load a session entry from the OpenClaw session store.
 * Reads ~/.openclaw/agents/<agentId>/sessions/sessions.json
 */
function loadSessionEntry(
  sessionKey: string,
  agentId: string
): Record<string, unknown> | null {
  const openclawDir = getOpenClawDir();
  const storePath = join(openclawDir, "agents", agentId, "sessions", "sessions.json");

  if (!existsSync(storePath)) {
    return null;
  }

  try {
    const raw = readFileSync(storePath, "utf-8");
    const store = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    return store[sessionKey] ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the effective context window limit from OpenClaw config.
 *
 * Resolution order (matches Gateway logic):
 *   1. agents.<agentId>.contextTokens  (per-agent override)
 *   2. agents.defaults.contextTokens   (global default)
 *   3. OPENCLAW_DEFAULT_CONTEXT_TOKENS  (200k — Gateway hardcoded default)
 *
 * Note: The session entry's `contextTokens` stores the MODEL's max context
 * (e.g. 1M for Sonnet 4.5) which is NOT the operating limit. The real limit
 * is set in config or defaults to 200k.
 */
function resolveEffectiveContextLimit(agentId: string): number {
  const openclawDir = getOpenClawDir();
  const configPaths = [
    join(openclawDir, "openclaw.json"),
    join(openclawDir, "openclaw.json5"),
  ];

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) continue;
    try {
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON5.parse(raw) as Record<string, unknown>;
      const agents = config.agents as Record<string, unknown> | undefined;
      if (!agents) continue;

      // 1. Per-agent override: agents.<agentId>.contextTokens
      const agentCfg = agents[agentId] as Record<string, unknown> | undefined;
      if (agentCfg?.contextTokens && typeof agentCfg.contextTokens === "number") {
        return agentCfg.contextTokens;
      }

      // 2. Global default: agents.defaults.contextTokens
      const defaults = agents.defaults as Record<string, unknown> | undefined;
      if (defaults?.contextTokens && typeof defaults.contextTokens === "number") {
        return defaults.contextTokens;
      }
    } catch {
      // Continue to next config path
    }
  }

  // 3. Fallback: OpenClaw's hardcoded default
  return OPENCLAW_DEFAULT_CONTEXT_TOKENS;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionKey = searchParams.get("sessionKey");

  if (!sessionKey) {
    return NextResponse.json(
      { error: "sessionKey is required" },
      { status: 400 }
    );
  }

  try {
    const agentId = parseAgentId(sessionKey);
    if (!agentId) {
      return NextResponse.json(
        { error: "Could not parse agentId from sessionKey" },
        { status: 400 }
      );
    }

    const entry = loadSessionEntry(sessionKey, agentId);
    if (!entry) {
      console.log(`[Session Status] No session data for key=${sessionKey} agent=${agentId}`);
      return new NextResponse(null, { status: 204 });
    }

    // Map the raw SessionEntry to our SessionStatus type
    const inputTokens = (entry.inputTokens as number) ?? 0;
    const outputTokens = (entry.outputTokens as number) ?? 0;
    const totalTokens = (entry.totalTokens as number) ?? 0;

    // The session entry's contextTokens is the MODEL's max (e.g. 1M for Sonnet 4.5).
    // The real operating limit comes from config or defaults to 200k.
    const modelMaxContext = (entry.contextTokens as number) ?? 0;
    const effectiveLimit = resolveEffectiveContextLimit(agentId);
    const percentage = effectiveLimit > 0
      ? Math.round((totalTokens / effectiveLimit) * 100)
      : 0;

    // Extract system prompt report if available
    const spr = entry.systemPromptReport as Record<string, unknown> | undefined;
    let systemPrompt: SessionStatus["systemPrompt"] = undefined;

    if (spr) {
      const sp = spr.systemPrompt as Record<string, number> | undefined;
      const skills = spr.skills as Record<string, unknown> | undefined;
      const tools = spr.tools as Record<string, unknown> | undefined;
      const files = spr.injectedWorkspaceFiles as Array<Record<string, unknown>> | undefined;

      systemPrompt = {
        totalChars: sp?.chars ?? 0,
        projectContextChars: sp?.projectContextChars ?? 0,
        nonProjectContextChars: sp?.nonProjectContextChars ?? 0,
        skills: {
          promptChars: (skills?.promptChars as number) ?? 0,
          count: Array.isArray(skills?.entries) ? (skills.entries as unknown[]).length : 0,
        },
        tools: {
          listChars: (tools?.listChars as number) ?? 0,
          schemaChars: (tools?.schemaChars as number) ?? 0,
          count: Array.isArray(tools?.entries) ? (tools.entries as unknown[]).length : 0,
        },
        workspaceFiles: (files ?? []).map((f) => ({
          name: (f.name as string) ?? "",
          injectedChars: (f.injectedChars as number) ?? 0,
          truncated: (f.truncated as boolean) ?? false,
        })),
      };
    }

    const result: SessionStatus = {
      sessionKey,
      sessionId: (entry.sessionId as string) ?? "",
      agentId,
      model: (entry.model as string) ?? "unknown",
      modelProvider: (entry.modelProvider as string) ?? "unknown",
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: totalTokens,
      },
      context: {
        used: totalTokens,
        limit: effectiveLimit,
        modelMax: modelMaxContext,
        percentage: Math.min(percentage, 100),
      },
      compactions: (entry.compactionCount as number) ?? 0,
      thinkingLevel: (entry.thinkingLevel as string) ?? null,
      updatedAt: (entry.updatedAt as number) ?? 0,
      systemPrompt,
    };

    return NextResponse.json(result);
  } catch (err) {
    const message = (err as Error).message;
    console.error("[Session Status] Failed:", message);
    return NextResponse.json(
      { error: sanitizeForApi(message) },
      { status: 502 }
    );
  }
}
