import { NextRequest, NextResponse } from "next/server";

/**
 * Next.js Middleware — applies security checks to all API routes.
 *
 * In production, rejects requests from non-localhost IPs.
 * Castle is a local-first app and should never be exposed to the internet.
 */

const LOCALHOST_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

export function middleware(request: NextRequest) {
  // Only enforce in production — dev is always allowed
  if (process.env.NODE_ENV === "development") {
    return NextResponse.next();
  }

  // Check if the request originates from localhost
  const host = request.headers.get("host") || "";
  const hostname = host.split(":")[0];

  const forwarded = request.headers.get("x-forwarded-for");
  const clientIp = forwarded?.split(",")[0].trim();

  // If x-forwarded-for is present and it's not localhost, reject
  if (clientIp && !LOCALHOST_HOSTS.has(clientIp)) {
    return NextResponse.json(
      { error: "Forbidden — Castle is only accessible from localhost" },
      { status: 403 }
    );
  }

  // If the host header isn't a localhost variant, reject
  if (hostname && !LOCALHOST_HOSTS.has(hostname)) {
    return NextResponse.json(
      { error: "Forbidden — Castle is only accessible from localhost" },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

// Only run middleware on API routes
export const config = {
  matcher: "/api/:path*",
};
