import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { checkCsrf, checkRateLimit, rateLimitKey, sanitizeForApi } from "../api-security";

// Helper to create a NextRequest with specific headers
function makeRequest(
  url = "http://localhost:3333/api/test",
  headers: Record<string, string> = {},
  method = "POST"
): NextRequest {
  return new NextRequest(new URL(url), {
    method,
    headers: headers,
  } as never);
}

// ============================================================================
// CSRF
// ============================================================================

describe("checkCsrf", () => {
  it("should allow requests with matching origin", () => {
    const req = makeRequest("http://localhost:3333/api/test", {
      origin: "http://localhost:3333",
      host: "localhost:3333",
    });
    expect(checkCsrf(req)).toBeNull();
  });

  it("should allow requests with matching 127.0.0.1 origin", () => {
    const req = makeRequest("http://localhost:3333/api/test", {
      origin: "http://127.0.0.1:3333",
      host: "localhost:3333",
    });
    expect(checkCsrf(req)).toBeNull();
  });

  it("should reject cross-origin requests", () => {
    const req = makeRequest("http://localhost:3333/api/test", {
      origin: "http://evil.com",
      host: "localhost:3333",
    });
    const result = checkCsrf(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it("should allow requests with no origin or referer (CLI/curl)", () => {
    const req = makeRequest("http://localhost:3333/api/test", {
      host: "localhost:3333",
    });
    expect(checkCsrf(req)).toBeNull();
  });

  it("should check referer when origin is missing", () => {
    const req = makeRequest("http://localhost:3333/api/test", {
      referer: "http://localhost:3333/chat/abc",
      host: "localhost:3333",
    });
    expect(checkCsrf(req)).toBeNull();
  });

  it("should reject cross-origin referer", () => {
    const req = makeRequest("http://localhost:3333/api/test", {
      referer: "http://evil.com/phishing",
      host: "localhost:3333",
    });
    const result = checkCsrf(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});

// ============================================================================
// Rate Limiting
// ============================================================================

describe("checkRateLimit", () => {
  // Use unique keys per test to avoid cross-test pollution
  let keyCounter = 0;
  function uniqueKey() {
    return `test-rate-${Date.now()}-${keyCounter++}`;
  }

  it("should allow requests within the limit", () => {
    const key = uniqueKey();
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5)).toBeNull();
    }
  });

  it("should block requests exceeding the limit", () => {
    const key = uniqueKey();
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, 3)).toBeNull();
    }
    const result = checkRateLimit(key, 3);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("should use sliding window (old timestamps expire)", () => {
    const key = uniqueKey();
    // Fill the limit with a tiny window
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, 3, 50)).toBeNull(); // 50ms window
    }
    // Exceed limit immediately
    expect(checkRateLimit(key, 3, 50)).not.toBeNull();
  });
});

// ============================================================================
// rateLimitKey
// ============================================================================

describe("rateLimitKey", () => {
  it("should combine IP and route", () => {
    const req = makeRequest("http://localhost:3333/api/test", {
      "x-forwarded-for": "192.168.1.100",
    });
    expect(rateLimitKey(req, "chat:send")).toBe("192.168.1.100:chat:send");
  });

  it("should fall back to x-real-ip", () => {
    const req = makeRequest("http://localhost:3333/api/test", {
      "x-real-ip": "10.0.0.1",
    });
    expect(rateLimitKey(req, "search")).toBe("10.0.0.1:search");
  });

  it("should use 'local' when no IP headers", () => {
    const req = makeRequest("http://localhost:3333/api/test");
    expect(rateLimitKey(req, "ping")).toBe("local:ping");
  });
});

// ============================================================================
// sanitizeForApi
// ============================================================================

describe("sanitizeForApi", () => {
  it("should redact OpenClaw tokens (rew_ pattern)", () => {
    const result = sanitizeForApi("Token: rew_abc123def456");
    expect(result).toContain("rew_***");
    expect(result).not.toContain("abc123def456");
  });

  it("should redact PEM keys", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBog...\n-----END RSA PRIVATE KEY-----";
    const result = sanitizeForApi(`Key: ${pem}`);
    expect(result).toContain("[REDACTED KEY]");
    expect(result).not.toContain("MIIBog");
  });

  it("should redact long hex strings (32+ chars)", () => {
    const hex = "abcdef1234567890abcdef1234567890";
    const result = sanitizeForApi(`Hash: ${hex}`);
    expect(result).toContain("abcdef12***");
    expect(result).not.toContain(hex);
  });

  it("should leave normal text untouched", () => {
    expect(sanitizeForApi("Hello world")).toBe("Hello world");
  });

  it("should handle empty strings", () => {
    expect(sanitizeForApi("")).toBe("");
  });
});
