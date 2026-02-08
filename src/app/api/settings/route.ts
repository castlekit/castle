import { NextRequest, NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/db/queries";

// Known setting keys and their validation
const VALID_KEYS: Record<string, { maxLength: number }> = {
  displayName: { maxLength: 100 },
  avatarPath: { maxLength: 255 },
  tooltips: { maxLength: 5 }, // "true" or "false"
};

// ============================================================================
// GET /api/settings — Get all settings
// ============================================================================

export async function GET() {
  try {
    const all = getAllSettings();
    return NextResponse.json(all);
  } catch (err) {
    console.error("[Settings] GET failed:", (err as Error).message);
    return NextResponse.json(
      { error: "Failed to load settings" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/settings — Update one or more settings
// ============================================================================

export async function POST(request: NextRequest) {
  let body: Record<string, string>;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  try {
    for (const [key, value] of Object.entries(body)) {
      // Validate key
      if (!VALID_KEYS[key]) {
        return NextResponse.json(
          { error: `Unknown setting: ${key}` },
          { status: 400 }
        );
      }

      // Validate value type
      if (typeof value !== "string") {
        return NextResponse.json(
          { error: `Setting "${key}" must be a string` },
          { status: 400 }
        );
      }

      // Validate length
      const trimmed = value.trim();
      if (trimmed.length > VALID_KEYS[key].maxLength) {
        return NextResponse.json(
          { error: `Setting "${key}" must be at most ${VALID_KEYS[key].maxLength} characters` },
          { status: 400 }
        );
      }

      setSetting(key, trimmed);
    }

    const all = getAllSettings();
    return NextResponse.json(all);
  } catch (err) {
    console.error("[Settings] POST failed:", (err as Error).message);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}
