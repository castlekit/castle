import { describe, it, expect, vi, afterEach } from "vitest";
import { formatDate, formatDateTime, formatTime, formatTimeAgo } from "../date-utils";

// ============================================================================
// formatTimeAgo (uses Date.now() internally, so we mock it)
// ============================================================================

describe("formatTimeAgo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 'just now' for < 60 seconds", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(formatTimeAgo(now - 5_000)).toBe("just now");
    expect(formatTimeAgo(now - 59_000)).toBe("just now");
  });

  it("should return minutes ago", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(formatTimeAgo(now - 60_000)).toBe("1m ago");
    expect(formatTimeAgo(now - 5 * 60_000)).toBe("5m ago");
    expect(formatTimeAgo(now - 59 * 60_000)).toBe("59m ago");
  });

  it("should return hours ago", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(formatTimeAgo(now - 60 * 60_000)).toBe("1h ago");
    expect(formatTimeAgo(now - 12 * 60 * 60_000)).toBe("12h ago");
    expect(formatTimeAgo(now - 23 * 60 * 60_000)).toBe("23h ago");
  });

  it("should return days ago", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(formatTimeAgo(now - 24 * 60 * 60_000)).toBe("1d ago");
    expect(formatTimeAgo(now - 6 * 24 * 60 * 60_000)).toBe("6d ago");
  });

  it("should return weeks ago", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(formatTimeAgo(now - 7 * 24 * 60 * 60_000)).toBe("1w ago");
    expect(formatTimeAgo(now - 28 * 24 * 60 * 60_000)).toBe("4w ago");
  });

  it("should return months ago", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(formatTimeAgo(now - 60 * 24 * 60 * 60_000)).toBe("2mo ago");
  });

  it("should return years ago", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(formatTimeAgo(now - 400 * 24 * 60 * 60_000)).toBe("1y ago");
  });
});

// ============================================================================
// formatDate, formatDateTime, formatTime — locale-dependent but stable
// ============================================================================

describe("formatDate", () => {
  it("should format a timestamp as a readable date", () => {
    // 2026-02-07 UTC
    const ts = new Date("2026-02-07T12:00:00Z").getTime();
    const result = formatDate(ts);
    // Should contain day, month, and year
    expect(result).toContain("February");
    expect(result).toContain("2026");
  });

  it("should handle epoch zero", () => {
    const result = formatDate(0);
    expect(result).toContain("1970");
  });
});

describe("formatDateTime", () => {
  it("should include both date and time parts", () => {
    const ts = new Date("2026-02-07T14:30:00Z").getTime();
    const result = formatDateTime(ts);
    expect(result).toContain("February");
    expect(result).toContain("2026");
    expect(result).toContain("at");
  });
});

describe("formatTime", () => {
  it("should format just the time", () => {
    const ts = new Date("2026-02-07T14:30:00Z").getTime();
    const result = formatTime(ts);
    // Should be a short time string (locale-dependent but should contain digits)
    expect(result).toMatch(/\d/);
  });
});
