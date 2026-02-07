import WebSocket from "ws";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { getGatewayUrl, readOpenClawToken, readConfig, configExists } from "./config";
import { getOrCreateIdentity, signChallenge, saveDeviceToken, getDeviceToken } from "./device-identity";

// ============================================================================
// Types
// ============================================================================

interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}

interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
    retryAfterMs?: number;
  };
}

interface EventFrame {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: { version: number };
}

type GatewayFrame = ResponseFrame | EventFrame | { type: string; [key: string]: unknown };

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "pairing" | "error";

export interface GatewayEvent {
  event: string;
  payload?: unknown;
  seq?: number;
}

// ============================================================================
// Singleton Gateway Connection
// ============================================================================

class GatewayConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private _state: ConnectionState = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000; // 30s max
  private baseReconnectDelay = 1000; // 1s base
  private requestTimeout = 15000; // 15s per request
  private connectTimeout = 10000; // 10s for connect handshake
  private _serverInfo: { version?: string; connId?: string } = {};
  private _features: { methods?: string[]; events?: string[] } = {};
  private shouldReconnect = true;

  get state(): ConnectionState {
    return this._state;
  }

  get serverInfo() {
    return this._serverInfo;
  }

  get isConnected(): boolean {
    return this._state === "connected";
  }

  get isConfigured(): boolean {
    // Check if we can find a token from any source
    return !!this.resolveToken();
  }

  // --------------------------------------------------------------------------
  // Connection lifecycle
  // --------------------------------------------------------------------------

  start(): void {
    if (this._state === "connecting" || this._state === "connected") return;
    this.shouldReconnect = true;
    this.connect();
  }

  stop(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.cleanup();
  }

  private connect(): void {
    const token = this.resolveToken();
    if (!token) {
      this._state = "error";
      this.emit("stateChange", this._state);
      console.error("[Gateway] No token available. Run 'castle setup' to configure.");
      return;
    }

    const url = getGatewayUrl();
    this._state = "connecting";
    this.emit("stateChange", this._state);

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.error("[Gateway] Failed to create WebSocket:", err);
      this._state = "error";
      this.emit("stateChange", this._state);
      this.scheduleReconnect();
      return;
    }

    const connectTimer = setTimeout(() => {
      console.error("[Gateway] Connect timeout");
      this.cleanup();
      this.scheduleReconnect();
    }, this.connectTimeout);

    // Load device identity for auth
    let deviceIdentity: { deviceId: string; publicKey: string } | null = null;
    try {
      const identity = getOrCreateIdentity();
      deviceIdentity = { deviceId: identity.deviceId, publicKey: identity.publicKey };
    } catch (err) {
      console.warn("[Gateway] Could not load device identity:", err);
    }

    // Check for a saved device token from previous pairing
    const savedDeviceToken = getDeviceToken();

    this.ws.on("open", () => {
      const connectId = randomUUID();

      // Build the connect frame.
      // The `device` field is ONLY included when responding to a connect.challenge,
      // because the Gateway requires signature + signedAt when device is present.
      const buildConnectFrame = (challenge?: {
        nonce: string;
        signature: string;
      }): RequestFrame => {
        const authPayload: Record<string, unknown> = { token };
        if (savedDeviceToken) {
          authPayload.deviceToken = savedDeviceToken;
        }

        const params: Record<string, unknown> = {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "gateway-client",
            displayName: "Castle",
            version: "0.0.1",
            platform: process.platform,
            mode: "backend",
          },
          auth: authPayload,
          role: "operator",
          scopes: ["operator.admin"],
          caps: [],
        };

        // Only include device when responding to a challenge (Gateway requires signature)
        if (challenge && deviceIdentity) {
          params.device = {
            id: deviceIdentity.deviceId,
            publicKey: deviceIdentity.publicKey,
            signature: challenge.signature,
            nonce: challenge.nonce,
            signedAt: Date.now(),
          };
        }

        return { type: "req", id: connectId, method: "connect", params };
      };

      // Handle handshake messages (may include connect.challenge events)
      const onHandshakeMessage = (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString());

          // Handle connect.challenge — for now, skip device signing.
          // Token-only auth works fine without responding to the challenge.
          // Phase 2 will add device signing once Gateway pairing approval is ready.
          if (msg.type === "event" && msg.event === "connect.challenge") {
            // Challenge acknowledged but not responded to — token auth continues
            return;
          }

          // Handle device.pairing.required — Gateway wants operator approval
          if (msg.type === "event" && msg.event === "device.pairing.required") {
            console.log("[Gateway] Device pairing approval required");
            console.log("[Gateway] Approve this device in your OpenClaw dashboard to continue...");
            this._state = "pairing";
            this.emit("stateChange", this._state);
            this.emit("pairingRequired", msg.payload);
            // Forward as a gateway event too
            this.emit("gatewayEvent", {
              event: msg.event,
              payload: msg.payload,
              seq: msg.seq,
            } as GatewayEvent);
            return;
          }

          // Handle device.pairing.approved — save the device token
          if (msg.type === "event" && msg.event === "device.pairing.approved") {
            const deviceToken = msg.payload?.deviceToken;
            if (deviceToken && typeof deviceToken === "string") {
              console.log("[Gateway] Device pairing approved — saving token");
              try {
                saveDeviceToken(deviceToken, url);
              } catch (err) {
                console.error("[Gateway] Failed to save device token:", err);
              }
            }
            this.emit("pairingApproved", msg.payload);
            // Forward as a gateway event too
            this.emit("gatewayEvent", {
              event: msg.event,
              payload: msg.payload,
              seq: msg.seq,
            } as GatewayEvent);
            // Don't return — the next message should be the connect response
            return;
          }

          // Standard response frame to our connect request
          if (msg.type === "res" && msg.id === connectId) {
            clearTimeout(connectTimer);

            if (msg.ok) {
              const helloOk = msg.payload || {};

              // If hello-ok includes a deviceToken, save it
              if (helloOk.deviceToken && typeof helloOk.deviceToken === "string") {
                try {
                  saveDeviceToken(helloOk.deviceToken, url);
                  console.log("[Gateway] Device token received and saved");
                } catch (err) {
                  console.error("[Gateway] Failed to save device token:", err);
                }
              }

              this._state = "connected";
              this._serverInfo = helloOk.server || {};
              this._features = helloOk.features || {};
              this.reconnectAttempts = 0;
              this.emit("stateChange", this._state);
              this.emit("connected", helloOk);
              console.log(`[Gateway] Connected to OpenClaw v${helloOk.server?.version || "unknown"}`);
              // Switch to normal message handler
              this.ws?.off("message", onHandshakeMessage);
              this.ws?.on("message", this.onMessage.bind(this));
            } else {
              const errMsg = msg.error?.message || "Connect rejected";
              console.error(`[Gateway] Connect failed: ${errMsg}`);
              this.ws?.off("message", onHandshakeMessage);
              this.cleanup();
              // Don't reconnect on auth errors
              if (msg.error?.code === "auth_failed") {
                this._state = "error";
                this.emit("stateChange", this._state);
                this.emit("authError", msg.error);
              } else {
                this.scheduleReconnect();
              }
            }
            return;
          }

          // Forward any events that arrive during handshake
          if (msg.type === "event") {
            this.emit("gatewayEvent", {
              event: msg.event,
              payload: msg.payload,
              seq: msg.seq,
            } as GatewayEvent);
          }
        } catch (err) {
          console.error("[Gateway] Failed to parse handshake message:", err);
        }
      };

      this.ws!.on("message", onHandshakeMessage);
      this.ws!.send(JSON.stringify(buildConnectFrame()));
    });

    this.ws.on("error", (err) => {
      clearTimeout(connectTimer);
      console.error("[Gateway] WebSocket error:", err.message);
      this.cleanup();
      this.scheduleReconnect();
    });

    this.ws.on("close", (code, reason) => {
      clearTimeout(connectTimer);
      const wasConnected = this._state === "connected";
      this.cleanup();
      if (wasConnected) {
        console.log(`[Gateway] Disconnected (code: ${code}, reason: ${reason?.toString() || "none"})`);
      }
      this.scheduleReconnect();
    });
  }

  private onMessage(data: WebSocket.RawData): void {
    let msg: GatewayFrame;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === "res") {
      const res = msg as ResponseFrame;
      const pending = this.pending.get(res.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(res.id);
        if (res.ok) {
          pending.resolve(res.payload);
        } else {
          pending.reject(
            new Error(res.error?.message || "Request failed")
          );
        }
      }
    } else if (msg.type === "event") {
      const evt = msg as EventFrame;
      this.emit("gatewayEvent", {
        event: evt.event,
        payload: evt.payload,
        seq: evt.seq,
      } as GatewayEvent);
    }
  }

  // --------------------------------------------------------------------------
  // RPC
  // --------------------------------------------------------------------------

  async request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (!this.ws || this._state !== "connected") {
      throw new Error("Gateway not connected");
    }

    const id = randomUUID();
    const frame: RequestFrame = { type: "req", id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.requestTimeout);

      this.pending.set(id, {
        resolve: resolve as (payload: unknown) => void,
        reject,
        timer,
      });

      this.ws!.send(JSON.stringify(frame), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error(`Send failed: ${err.message}`));
        }
      });
    });
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private resolveToken(): string | null {
    // 1. Saved device token from previous pairing
    const deviceToken = getDeviceToken();
    if (deviceToken) return deviceToken;

    // 2. Castle config token
    if (configExists()) {
      const config = readConfig();
      if (config.openclaw.gateway_token) {
        return config.openclaw.gateway_token;
      }
    }

    // 3. Auto-detect from OpenClaw config
    return readOpenClawToken();
  }

  private cleanup(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        try { this.ws.close(); } catch { /* ignore */ }
      }
      this.ws = null;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Connection closed"));
      this.pending.delete(id);
    }

    if (this._state !== "error" && this._state !== "pairing") {
      this._state = "disconnected";
      this.emit("stateChange", this._state);
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    this.clearReconnectTimer();

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );
    this.reconnectAttempts++;

    console.log(`[Gateway] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// ============================================================================
// Singleton export
// ============================================================================

let _gateway: GatewayConnection | null = null;

export function getGateway(): GatewayConnection {
  if (!_gateway) {
    _gateway = new GatewayConnection();
  }
  return _gateway;
}

/**
 * Ensure the gateway is started and return the instance.
 * Safe to call multiple times -- only connects once.
 */
export function ensureGateway(): GatewayConnection {
  const gw = getGateway();
  if (gw.state === "disconnected") {
    gw.start();
  }
  return gw;
}
