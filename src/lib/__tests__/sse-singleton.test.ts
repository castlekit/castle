/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to test the module's internal functions. Since they use EventSource,
// we must mock it in jsdom. EventSource is not available in jsdom by default.

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0; // CONNECTING
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Simulate open after microtask
    queueMicrotask(() => {
      this.readyState = 1; // OPEN
      this.onopen?.();
    });
  }

  simulateMessage(data: string) {
    this.onmessage?.({ data });
  }

  simulateError() {
    this.onerror?.();
  }

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
}

// Install mock before importing the module
vi.stubGlobal("EventSource", MockEventSource);

describe("SSE Singleton", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    // Reset module state by re-importing
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should open connection on first subscribe and close on last unsubscribe", async () => {
    const { subscribe } = await import("../sse-singleton");

    const handler = vi.fn();
    const unsub = subscribe("test", handler);

    // Should have opened a connection
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].url).toBe("/api/openclaw/events");

    // Unsubscribe should close
    unsub();
    expect(MockEventSource.instances[0].close).toHaveBeenCalled();
  });

  it("should share connection across multiple subscribers", async () => {
    const { subscribe } = await import("../sse-singleton");

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const unsub1 = subscribe("chat", handler1);
    const unsub2 = subscribe("state", handler2);

    // Only one EventSource should be created
    expect(MockEventSource.instances.length).toBe(1);

    // First unsubscribe should NOT close
    unsub1();
    expect(MockEventSource.instances[0].close).not.toHaveBeenCalled();

    // Second unsubscribe should close
    unsub2();
    expect(MockEventSource.instances[0].close).toHaveBeenCalled();
  });

  it("should dispatch events to matching handlers", async () => {
    const { subscribe } = await import("../sse-singleton");

    const chatHandler = vi.fn();
    const stateHandler = vi.fn();

    const unsub1 = subscribe("chat", chatHandler);
    const unsub2 = subscribe("castle.state", stateHandler);

    // Wait for connection to open
    await new Promise((r) => setTimeout(r, 10));

    const es = MockEventSource.instances[0];

    // Simulate a chat event
    es.simulateMessage(JSON.stringify({ event: "chat", payload: { runId: "r1" } }));
    expect(chatHandler).toHaveBeenCalledWith({ event: "chat", payload: { runId: "r1" } });
    expect(stateHandler).not.toHaveBeenCalled();

    // Simulate a state event
    es.simulateMessage(JSON.stringify({ event: "castle.state", payload: { state: "connected" } }));
    expect(stateHandler).toHaveBeenCalledWith({ event: "castle.state", payload: { state: "connected" } });

    unsub1();
    unsub2();
  });

  it("should support wildcard patterns", async () => {
    const { subscribe } = await import("../sse-singleton");

    const wildcardHandler = vi.fn();
    const unsub = subscribe("agent.*", wildcardHandler);

    await new Promise((r) => setTimeout(r, 10));

    const es = MockEventSource.instances[0];
    es.simulateMessage(JSON.stringify({ event: "agent.created", payload: {} }));
    es.simulateMessage(JSON.stringify({ event: "agent.updated", payload: {} }));
    es.simulateMessage(JSON.stringify({ event: "chat", payload: {} }));

    expect(wildcardHandler).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("should deduplicate events by seq number", async () => {
    const { subscribe } = await import("../sse-singleton");

    const handler = vi.fn();
    const unsub = subscribe("chat", handler);

    await new Promise((r) => setTimeout(r, 10));

    const es = MockEventSource.instances[0];

    // Send events with seq
    es.simulateMessage(JSON.stringify({ event: "chat", seq: 1, payload: {} }));
    es.simulateMessage(JSON.stringify({ event: "chat", seq: 1, payload: {} })); // duplicate
    es.simulateMessage(JSON.stringify({ event: "chat", seq: 2, payload: {} }));

    expect(handler).toHaveBeenCalledTimes(2); // seq 1 and seq 2

    unsub();
  });

  it("should track last event timestamp", async () => {
    const { subscribe, getLastEventTimestamp } = await import("../sse-singleton");

    const handler = vi.fn();
    const unsub = subscribe("*", handler);

    await new Promise((r) => setTimeout(r, 10));

    const before = Date.now();
    const es = MockEventSource.instances[0];
    es.simulateMessage(JSON.stringify({ event: "test", payload: {} }));

    const timestamp = getLastEventTimestamp();
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(Date.now());

    unsub();
  });

  it("should notify error handlers on connection error", async () => {
    const { subscribe, onError } = await import("../sse-singleton");

    const handler = vi.fn();
    const errorHandler = vi.fn();

    const unsub1 = subscribe("*", handler);
    const unsub2 = onError(errorHandler);

    await new Promise((r) => setTimeout(r, 10));

    const es = MockEventSource.instances[0];
    es.simulateError();

    expect(errorHandler).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });

  it("should handle malformed event data gracefully", async () => {
    const { subscribe } = await import("../sse-singleton");

    const handler = vi.fn();
    const unsub = subscribe("*", handler);

    await new Promise((r) => setTimeout(r, 10));

    const es = MockEventSource.instances[0];
    // Send invalid JSON
    es.simulateMessage("not json");

    // Handler should not be called
    expect(handler).not.toHaveBeenCalled();

    unsub();
  });
});
