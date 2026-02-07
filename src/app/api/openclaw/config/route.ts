import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import JSON5 from "json5";
import { getOpenClawDir } from "@/lib/config";
import { ensureGateway } from "@/lib/gateway-connection";

export const dynamic = "force-dynamic";

/**
 * GET /api/openclaw/config
 * God mode: reads OpenClaw config from filesystem
 */
export async function GET() {
  const configPath = join(getOpenClawDir(), "openclaw.json");

  if (!existsSync(configPath)) {
    // Try json5
    const json5Path = join(getOpenClawDir(), "openclaw.json5");
    if (!existsSync(json5Path)) {
      return NextResponse.json(
        { error: "OpenClaw config not found" },
        { status: 404 }
      );
    }

    try {
      const raw = readFileSync(json5Path, "utf-8");
      const config = JSON5.parse(raw);
      return NextResponse.json({ config, format: "json5" });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to parse config" },
        { status: 500 }
      );
    }
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON5.parse(raw);
    return NextResponse.json({ config, format: "json" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to parse config" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/openclaw/config
 * Update OpenClaw config via Gateway's config.patch method.
 * Body: { patch: { ... } } -- the patch to apply
 */
export async function PATCH(request: NextRequest) {
  const gw = ensureGateway();

  if (!gw.isConnected) {
    return NextResponse.json(
      { error: "Gateway not connected" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { patch } = body;

    if (!patch) {
      return NextResponse.json(
        { error: "Missing 'patch' field in request body" },
        { status: 400 }
      );
    }

    await gw.request("config.patch", patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Config patch failed" },
      { status: 500 }
    );
  }
}
