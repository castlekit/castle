import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import JSON5 from "json5";
import { getOpenClawDir } from "@/lib/config";
import { ensureGateway } from "@/lib/gateway-connection";
import { checkCsrf } from "@/lib/api-security";

export const dynamic = "force-dynamic";

/**
 * Deep-clone a config object, redacting sensitive fields so they
 * are never returned over HTTP.
 */
function redactSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // Redact any key that looks like a token or secret
    const lower = key.toLowerCase();
    if (
      lower === "token" ||
      lower === "secret" ||
      lower === "password" ||
      lower === "apikey" ||
      lower === "api_key" ||
      lower === "privatekey" ||
      lower === "private_key"
    ) {
      if (typeof value === "string" && value.length > 0) {
        result[key] = value.slice(0, 4) + "***";
      } else {
        result[key] = "***";
      }
    } else if (typeof value === "object") {
      result[key] = redactSecrets(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * GET /api/openclaw/config
 * Reads OpenClaw config from filesystem.
 * Sensitive fields (tokens, secrets, keys) are redacted before returning.
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
      return NextResponse.json({ config: redactSecrets(config), format: "json5" });
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
    return NextResponse.json({ config: redactSecrets(config), format: "json" });
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
 * Protected against CSRF — only requests from the Castle UI are allowed.
 * Body: { patch: { ... } } -- the patch to apply
 */
export async function PATCH(request: NextRequest) {
  const csrf = checkCsrf(request);
  if (csrf) return csrf;
  const gw = ensureGateway();

  if (!gw.isConnected) {
    return NextResponse.json(
      { error: "Gateway not connected" },
      { status: 503 }
    );
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const { patch } = body as { patch?: unknown };

    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return NextResponse.json(
        { error: "Missing or invalid 'patch' field — must be a JSON object" },
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
