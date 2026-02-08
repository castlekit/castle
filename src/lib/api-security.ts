import { NextRequest, NextResponse } from "next/server";

// ============================================================================
// Localhost guard — reject requests from non-local IPs
// ============================================================================

const LOCALHOST_IPS = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "localhost",
]);

/**
 * Reject requests that don't originate from localhost.
 * Uses x-forwarded-for (if behind a proxy) or falls back to the host header.
 * Returns a 403 response if the request is from a non-local IP, or null if OK.
 */
export function checkLocalhost(request: NextRequest): NextResponse | null {
  // If running in development, skip the check
  if (process.env.NODE_ENV === "development") return null;

  const forwarded = request.headers.get("x-forwarded-for");
  const host = request.headers.get("host") || "";

  // Check x-forwarded-for first (proxy scenario)
  if (forwarded) {
    const clientIp = forwarded.split(",")[0].trim();
    if (!LOCALHOST_IPS.has(clientIp)) {
      return NextResponse.json(
        { error: "Forbidden — Castle is only accessible from localhost" },
        { status: 403 }
      );
    }
  }

  // Check host header — reject if it's not a localhost variant
  const hostname = host.split(":")[0];
  if (hostname && !LOCALHOST_IPS.has(hostname)) {
    return NextResponse.json(
      { error: "Forbidden — Castle is only accessible from localhost" },
      { status: 403 }
    );
  }

  return null;
}

// ============================================================================
// Rate limiting — in-memory sliding window
// ============================================================================

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up stale entries every 5 minutes
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < 60_000);
      if (entry.timestamps.length === 0) rateLimitStore.delete(key);
    }
  }, 5 * 60_000);
  // Don't prevent process exit
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/**
 * Simple in-memory rate limiter using a sliding window.
 *
 * @param key    — Unique key for the rate limit bucket (e.g. "chat:send" or IP-based)
 * @param limit  — Max requests allowed within the window
 * @param windowMs — Window duration in milliseconds (default: 60 seconds)
 * @returns 429 response if rate limit exceeded, or null if OK
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs = 60_000
): NextResponse | null {
  ensureCleanup();

  const now = Date.now();
  let entry = rateLimitStore.get(key);

  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(key, entry);
  }

  // Drop timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  if (entry.timestamps.length >= limit) {
    return NextResponse.json(
      { error: "Too many requests — please slow down" },
      { status: 429 }
    );
  }

  entry.timestamps.push(now);
  return null;
}

/**
 * Helper to build a rate-limit key from the request IP + route.
 */
export function rateLimitKey(request: NextRequest, route: string): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  return `${ip}:${route}`;
}

// ============================================================================
// CSRF protection
// ============================================================================

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
