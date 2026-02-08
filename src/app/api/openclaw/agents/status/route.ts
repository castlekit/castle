import { NextRequest, NextResponse } from "next/server";
import { getAgentStatuses, setAgentStatus, type AgentStatusValue } from "@/lib/db/queries";
import { checkCsrf } from "@/lib/api-security";

const VALID_STATUSES: AgentStatusValue[] = ["idle", "thinking", "active"];

// ============================================================================
// GET /api/openclaw/agents/status — Get all agent statuses
// ============================================================================

export async function GET() {
  try {
    const statuses = getAgentStatuses();
    return NextResponse.json({ statuses });
  } catch (err) {
    console.error("[Agent Status] GET failed:", (err as Error).message);
    return NextResponse.json({ error: "Failed to get agent statuses" }, { status: 500 });
  }
}

// ============================================================================
// POST /api/openclaw/agents/status — Set an agent's status
// ============================================================================

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  let body: { agentId?: string; status?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.agentId || typeof body.agentId !== "string") {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  if (!body.status || !VALID_STATUSES.includes(body.status as AgentStatusValue)) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    setAgentStatus(body.agentId, body.status as AgentStatusValue);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Agent Status] POST failed:", (err as Error).message);
    return NextResponse.json({ error: "Failed to set agent status" }, { status: 500 });
  }
}
