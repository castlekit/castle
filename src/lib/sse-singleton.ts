/**
 * Shared SSE singleton for Castle.
 *
 * Creates a SINGLE EventSource connection to /api/openclaw/events that is
 * shared across all consumers (use-chat, use-openclaw, etc.).
 *
 * Ref-counted: the first subscriber opens the connection, the last
 * unsubscribe closes it. Events are dispatched to handlers by event type.
 *
 * Deduplication: tracks the last seen `seq` number and drops duplicates
 * as a safety net against multiple connections or reconnect replays.
 */

export interface SSEEvent {
  event: string;
  payload?: unknown;
  seq?: number;
}

type EventHandler = (evt: SSEEvent) => void;

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let es: EventSource | null = null;
let refCount = 0;
let lastSeq = -1;
let lastEventTimestamp = Date.now();

/** Handlers keyed by event pattern. Exact match or "*" for all events. */
const handlers = new Map<string, Set<EventHandler>>();

/** Error handlers notified on connection loss */
const errorHandlers = new Set<() => void>();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function matchesPattern(eventType: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    return eventType.startsWith(pattern.slice(0, -1));
  }
  return eventType === pattern;
}

function dispatch(evt: SSEEvent) {
  // Update last-event timestamp for heartbeat monitoring
  lastEventTimestamp = Date.now();

  // Dedup by seq — drop events we've already seen
  if (typeof evt.seq === "number") {
    if (evt.seq <= lastSeq) return;
    lastSeq = evt.seq;
  }

  const eventType = evt.event;
  for (const [pattern, handlerSet] of handlers) {
    if (matchesPattern(eventType, pattern)) {
      for (const handler of handlerSet) {
        try {
          handler(evt);
        } catch (err) {
          console.error("[SSE] Handler error:", err);
        }
      }
    }
  }
}

function openConnection() {
  if (es) return;

  es = new EventSource("/api/openclaw/events");
  lastEventTimestamp = Date.now();

  es.onmessage = (e) => {
    try {
      const evt: SSEEvent = JSON.parse(e.data);
      dispatch(evt);
    } catch {
      // Ignore parse errors
    }
  };

  es.onerror = () => {
    // EventSource auto-reconnects. Notify error handlers so they can
    // update UI state (e.g. show "disconnected").
    for (const handler of errorHandlers) {
      try {
        handler();
      } catch {
        // ignore
      }
    }
  };
}

function closeConnection() {
  if (es) {
    es.close();
    es = null;
  }
  lastSeq = -1;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Subscribe to SSE events matching a pattern.
 *
 * Patterns:
 *  - `"chat"`         — exact match for chat events
 *  - `"castle.state"` — exact match for state events
 *  - `"agent.*"`      — wildcard: matches agent.created, agent.updated, etc.
 *  - `"*"`            — all events
 *
 * Returns an unsubscribe function. Call it in your useEffect cleanup.
 */
export function subscribe(pattern: string, handler: EventHandler): () => void {
  if (!handlers.has(pattern)) {
    handlers.set(pattern, new Set());
  }
  handlers.get(pattern)!.add(handler);

  refCount++;
  if (refCount === 1) {
    openConnection();
  }

  return () => {
    const set = handlers.get(pattern);
    if (set) {
      set.delete(handler);
      if (set.size === 0) handlers.delete(pattern);
    }

    refCount--;
    if (refCount <= 0) {
      refCount = 0;
      closeConnection();
    }
  };
}

/**
 * Subscribe to connection error events.
 * Returns an unsubscribe function.
 */
export function onError(handler: () => void): () => void {
  errorHandlers.add(handler);
  return () => {
    errorHandlers.delete(handler);
  };
}

/**
 * Get the timestamp of the last received SSE event.
 * Used for heartbeat-based timeout detection.
 */
export function getLastEventTimestamp(): number {
  return lastEventTimestamp;
}

/**
 * Check if the SSE connection is currently open.
 */
export function isConnected(): boolean {
  return es !== null && es.readyState !== EventSource.CLOSED;
}
