import { NextRequest, NextResponse } from "next/server";

/**
 * Verify that a mutating API request originated from the Castle UI itself,
 * not from a cross-origin attacker (CSRF protection).
 *
 * Checks the Origin or Referer header against allowed localhost origins.
 * Returns a 403 response if the request fails the check, or null if it passes.
 */
export function checkCsrf(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // Build allowed origins from the request's own host
  const host = request.headers.get("host") || "localhost:3333";
  const allowed = new Set([
    `http://${host}`,
    `https://${host}`,
    // Common localhost variants
    "http://localhost:3333",
    "http://127.0.0.1:3333",
    "http://[::1]:3333",
  ]);

  // If Origin header is present, it must match
  if (origin) {
    if (allowed.has(origin)) return null;
    return NextResponse.json(
      { error: "Forbidden — cross-origin request rejected" },
      { status: 403 }
    );
  }

  // Fall back to Referer (browsers always send at least one for form submissions)
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (allowed.has(refOrigin)) return null;
    } catch {
      // Malformed referer
    }
    return NextResponse.json(
      { error: "Forbidden — cross-origin request rejected" },
      { status: 403 }
    );
  }

  // No Origin or Referer — likely a direct curl/CLI call, allow it.
  // Browsers ALWAYS send Origin on cross-origin requests,
  // so a missing Origin means it's not a browser-based CSRF attack.
  return null;
}

/**
 * Sanitize a string by redacting token patterns and key material.
 * Use this before returning any text content (logs, errors) via API.
 */
export function sanitizeForApi(str: string): string {
  return str
    .replace(/rew_[a-f0-9]+/gi, "rew_***")
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[REDACTED KEY]")
    .replace(/\b[a-f0-9]{32,}\b/gi, (m) => m.slice(0, 8) + "***");
}
