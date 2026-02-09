// ============================================================================
// Shared date formatting — consistent across the app
// ============================================================================
//
// Formats:
//   formatDate(ts)        → "9 February 2026"
//   formatDateTime(ts)    → "9 February 2026 at 2:24 am"
//   formatTime(ts)        → "2:24 am"
//   formatTimeAgo(ts)     → "3 hours ago", "2 days ago", etc.
//   formatDateShort(ts)   → "9 Feb" (for compact UI like search results)

/**
 * "9 February 2026"
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * "9 February 2026 at 2:24 am"
 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const datePart = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart} at ${timePart}`;
}

/**
 * "2:24 am"
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * "3 hours ago", "2 days ago", "just now", etc.
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(days / 365);
  return `${years}y ago`;
}
