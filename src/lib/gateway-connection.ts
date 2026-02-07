import WebSocket from "ws";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { getGatewayUrl, readOpenClawToken, readConfig, configExists } from "./config";
import { getOrCreateIdentity, signChallenge, saveDeviceToken, getDeviceToken, clearDeviceToken } from "./device-identity";

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
  // Device auth: set to true after "device identity mismatch" to fall back to token-only
  private _skipDeviceAuth = false;

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
    this._skipDeviceAuth = false; // Reset — try device auth on fresh start
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

    // Load device identity for auth (skip if previously rejected)
    let deviceIdentity: { deviceId: string; publicKey: string } | null = null;
    if (!this._skipDeviceAuth) {
      try {
        const identity = getOrCreateIdentity();
        deviceIdentity = { deviceId: identity.deviceId, publicKey: identity.publicKey };
      } catch (err) {
        console.warn("[Gateway] Could not load device identity:", err);
      }
    } else {
      console.log("[Gateway] Device auth disabled — using token-only");
    }

    // Check for a saved device token from previous pairing
    const savedDeviceToken = getDeviceToken();

    this.ws.on("open", () => {
      const connectId = randomUUID();

      // Build connect frame per Gateway protocol:
      // - Initial connect: token-only (no device field)
      // - Challenge response: include device { id, publicKey, signature, signedAt, nonce }
      // - Reconnect with deviceToken: use deviceToken as auth.token
      //
      // The device field is ONLY sent when responding to connect.challenge,
      // because the Gateway requires signature + signedAt whenever device is present.
      let challengeReceived = false;

      const buildConnectFrame = (challenge?: {
        nonce: string;
        signature: string;
      }): RequestFrame => {
        // Auth: use saved deviceToken on reconnect, otherwise gateway token
        const authPayload: Record<string, unknown> = {};
        if (savedDeviceToken) {
          authPayload.token = savedDeviceToken;
        } else {
          authPayload.token = token;
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

        // Only include device when responding to a challenge (with signature)
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

      // Handle handshake messages
      const onHandshakeMessage = (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString());

          // Handle connect.challenge — sign nonce and re-send connect with device identity
          if (msg.type === "event" && msg.event === "connect.challenge") {
            const nonce = msg.payload?.nonce;
            if (nonce && typeof nonce === "string" && deviceIdentity) {
              challengeReceived = true;
              console.log("[Gateway] Challenge received — signing with device key");
              try {
                const signature = signChallenge(nonce);
                const challengeFrame = buildConnectFrame({ nonce, signature });
                this.ws?.send(JSON.stringify(challengeFrame));
              } catch (err) {
                console.error("[Gateway] Failed to sign challenge:", err);
                challengeReceived = false;
              }
            } else {
              console.log("[Gateway] Challenge received but no device identity — skipping");
            }
            return;
          }

          // Handle device.pairing.required — waiting for operator approval
          if (msg.type === "event" && msg.event === "device.pairing.required") {
            console.log("[Gateway] Device pairing approval required");
            console.log("[Gateway] Approve this device in your OpenClaw dashboard to continue...");
            this._state = "pairing";
            this.emit("stateChange", this._state);
            this.emit("pairingRequired", msg.payload);
            this.emit("gatewayEvent", {
              event: msg.event,
              payload: msg.payload,
              seq: msg.seq,
            } as GatewayEvent);
            return;
          }

          // Handle device.pairing.approved — save the device token
          if (msg.type === "event" && msg.event === "device.pairing.approved") {
            const approvedToken = msg.payload?.deviceToken;
            if (approvedToken && typeof approvedToken === "string") {
              console.log("[Gateway] Device pairing approved — saving token");
              try {
                saveDeviceToken(approvedToken, url);
              } catch (err) {
                console.error("[Gateway] Failed to save device token:", err);
              }
            }
            this.emit("pairingApproved", msg.payload);
            this.emit("gatewayEvent", {
              event: msg.event,
              payload: msg.payload,
              seq: msg.seq,
            } as GatewayEvent);
            return;
          }

          // Standard response to our connect request
          if (msg.type === "res" && msg.id === connectId) {
            // If we already sent a challenge response, ignore error from the
            // initial (token-only) connect — the signed response is in flight.
            if (!msg.ok && challengeReceived) {
              console.log("[Gateway] Ignoring error from initial connect — challenge response pending");
              return;
            }

            clearTimeout(connectTimer);

            if (msg.ok) {
              const helloOk = msg.payload || {};

              // Save deviceToken from hello-ok (may be at payload.auth.deviceToken
              // or payload.deviceToken depending on Gateway version)
              const helloDeviceToken =
                helloOk.auth?.deviceToken || helloOk.deviceToken;
              if (helloDeviceToken && typeof helloDeviceToken === "string") {
                try {
                  saveDeviceToken(helloDeviceToken, url);
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
              const errCode = msg.error?.code;
              const errMsg = msg.error?.message || "Connect rejected";
              console.error(`[Gateway] Connect failed: ${errMsg}`);
              this.ws?.off("message", onHandshakeMessage);
              this.cleanup();

              if (errCode === "auth_failed") {
                // If we were using a stale device token, clear it and retry
                // with the gateway token instead
                if (savedDeviceToken) {
                  console.log("[Gateway] Device token rejected — clearing and retrying with gateway token");
                  clearDeviceToken();
                  this._skipDeviceAuth = false;
                  this.reconnectAttempts = 0;
                  this.scheduleReconnect();
                } else {
                  // Real auth failure — gateway token is invalid
                  this._state = "error";
                  this.emit("stateChange", this._state);
                  this.emit("authError", msg.error);
                }
              } else if (errCode === "protocol_mismatch" || errCode === "protocol_unsupported") {
                // Permanent failure — don't retry with the same protocol
                console.error("[Gateway] Protocol version not supported by this Gateway");
                this._state = "error";
                this.emit("stateChange", this._state);
                this.emit("authError", msg.error);
              } else {
                this.scheduleReconnect();
              }
            }
            return;
          }

          // Forward any other events during handshake
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
      const reasonStr = reason?.toString() || "none";
      this.cleanup();

      // If Gateway rejected device identity, retry without it (class-level flag persists)
      if (code === 1008 && reasonStr.includes("device identity mismatch") && !this._skipDeviceAuth) {
        console.log("[Gateway] Device identity not recognized — retrying with token-only auth");
        this._skipDeviceAuth = true;
        this.reconnectAttempts = 0;
        this.scheduleReconnect();
        return;
      }

      if (wasConnected) {
        console.log(`[Gateway] Disconnected (code: ${code}, reason: ${reasonStr})`);
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
