import WebSocket from "ws";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { readFileSync, realpathSync } from "fs";
import { dirname, join } from "path";
import { getGatewayUrl, readOpenClawToken, readConfig, configExists } from "./config";
import { getOrCreateIdentity, signDeviceAuth, saveDeviceToken, getDeviceToken, clearDeviceToken } from "./device-identity";

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
// Helpers
// ============================================================================

const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_NONCE_LENGTH = 1024;

/** Strip tokens and key material from strings before logging. */
function sanitize(str: string): string {
  return str
    .replace(/rew_[a-f0-9]+/gi, "rew_***")
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[REDACTED KEY]")
    .replace(/[a-f0-9]{32,}/gi, (m) => m.slice(0, 8) + "***");
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
  // Avatar URL mapping: hash → original Gateway URL (for proxying)
  private _avatarUrls = new Map<string, string>();

  get state(): ConnectionState {
    return this._state;
  }

  get serverInfo() {
    return this._serverInfo;
  }

  /** Store a mapping from avatar hash to its original Gateway URL */
  setAvatarUrl(hash: string, originalUrl: string): void {
    this._avatarUrls.set(hash, originalUrl);
  }

  /** Get the original Gateway URL for an avatar hash */
  getAvatarUrl(hash: string): string | null {
    return this._avatarUrls.get(hash) || null;
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
      console.error("[Gateway] Failed to create WebSocket:", (err as Error).message);
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
        console.warn("[Gateway] Could not load device identity:", (err as Error).message);
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

      // Connection identity constants — must match what's signed
      const CLIENT_ID = "gateway-client";
      const CLIENT_MODE = "backend";
      const ROLE = "operator";
      const SCOPES = ["operator.admin"];
      const authToken = savedDeviceToken || token;

      const buildConnectFrame = (challenge?: {
        nonce: string;
        signature: string;
        signedAt: number;
      }): RequestFrame => {
        const params: Record<string, unknown> = {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: CLIENT_ID,
            displayName: "Castle",
            version: "0.0.1",
            platform: process.platform,
            mode: CLIENT_MODE,
          },
          auth: { token: authToken },
          role: ROLE,
          scopes: SCOPES,
          caps: [],
        };

        // Only include device when responding to a challenge (with signature)
        if (challenge && deviceIdentity) {
          params.device = {
            id: deviceIdentity.deviceId,
            publicKey: deviceIdentity.publicKey,
            signature: challenge.signature,
            nonce: challenge.nonce,
            signedAt: challenge.signedAt,
          };
        }

        return { type: "req", id: connectId, method: "connect", params };
      };

      // Handle handshake messages
      const onHandshakeMessage = (data: WebSocket.RawData) => {
        const rawSize = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data.toString());
        if (rawSize > MAX_MESSAGE_SIZE) {
          console.error(`[Gateway] Message too large (${rawSize} bytes) — ignoring`);
          return;
        }
        try {
          const msg = JSON.parse(data.toString());

          // Handle connect.challenge — sign nonce and re-send connect with device identity
          if (msg.type === "event" && msg.event === "connect.challenge") {
            const nonce = msg.payload?.nonce;
            if (nonce && typeof nonce === "string" && nonce.length > MAX_NONCE_LENGTH) {
              console.error(`[Gateway] Challenge nonce too large (${nonce.length} bytes) — rejecting`);
              return;
            }
            if (nonce && typeof nonce === "string" && deviceIdentity) {
              challengeReceived = true;
              console.log("[Gateway] Challenge received — signing with device key");
              try {
                const { signature, signedAt } = signDeviceAuth({
                  nonce,
                  clientId: CLIENT_ID,
                  clientMode: CLIENT_MODE,
                  role: ROLE,
                  scopes: SCOPES,
                  token: authToken!,
                });
                const challengeFrame = buildConnectFrame({ nonce, signature, signedAt });
                this.ws?.send(JSON.stringify(challengeFrame));
              } catch (err) {
                console.error("[Gateway] Failed to sign challenge:", (err as Error).message);
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
                console.error("[Gateway] Failed to save device token:", (err as Error).message);
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
                  console.error("[Gateway] Failed to save device token:", (err as Error).message);
                }
              }

              this._state = "connected";
              this._serverInfo = helloOk.server || {};
              // If Gateway reports "dev" or missing version, read from installed package.json
              if (!this._serverInfo.version || this._serverInfo.version === "dev") {
                try {
                  const bin = execSync("which openclaw", { timeout: 2000, encoding: "utf-8" }).trim();
                  const real = realpathSync(bin);
                  const pkgPath = join(dirname(real), "package.json");
                  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
                  if (pkg.version) this._serverInfo.version = pkg.version;
                } catch { /* keep whatever the Gateway reported */ }
              }
              this._features = helloOk.features || {};
              this.reconnectAttempts = 0;
              this.emit("stateChange", this._state);
              this.emit("connected", helloOk);
              console.log(`[Gateway] Connected to OpenClaw ${this._serverInfo.version || "unknown"}`);
              // Switch to normal message handler
              this.ws?.off("message", onHandshakeMessage);
              this.ws?.on("message", this.onMessage.bind(this));
            } else {
              const errCode = msg.error?.code;
              const errMsg = msg.error?.message || "Connect rejected";
              console.error(`[Gateway] Connect failed: ${sanitize(errMsg)}`);
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
          console.error("[Gateway] Failed to parse handshake message:", (err as Error).message);
        }
      };

      this.ws!.on("message", onHandshakeMessage);
      this.ws!.send(JSON.stringify(buildConnectFrame()));
    });

    // Handle WebSocket upgrade failures (e.g. corporate proxies blocking WS)
    this.ws.on("unexpected-response", (_req, res) => {
      clearTimeout(connectTimer);
      console.error(`[Gateway] WebSocket upgrade failed (HTTP ${res.statusCode})`);
      if (res.statusCode === 401 || res.statusCode === 403) {
        console.error("[Gateway] Authentication rejected at HTTP level");
      } else if (res.statusCode === 502 || res.statusCode === 503) {
        console.error("[Gateway] Gateway may be behind a reverse proxy that doesn't support WebSocket");
      }
      this.cleanup();
      this.scheduleReconnect();
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

      // If Gateway rejected device auth (identity mismatch, bad signature, etc),
      // fall back to token-only auth
      if (code === 1008 && !this._skipDeviceAuth) {
        console.log(`[Gateway] Device auth rejected (${reasonStr}) — retrying with token-only auth`);
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
    const rawSize = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data.toString());
    if (rawSize > MAX_MESSAGE_SIZE) {
      console.error(`[Gateway] Message too large (${rawSize} bytes) — ignoring`);
      return;
    }
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
// Singleton export (uses globalThis to survive HMR in dev mode)
// ============================================================================

const GATEWAY_KEY = "__castle_gateway__" as const;

function getGlobalGateway(): GatewayConnection | null {
  return (globalThis as Record<string, unknown>)[GATEWAY_KEY] as GatewayConnection | null ?? null;
}

function setGlobalGateway(gw: GatewayConnection): void {
  (globalThis as Record<string, unknown>)[GATEWAY_KEY] = gw;
}

export function getGateway(): GatewayConnection {
  let gw = getGlobalGateway();
  if (!gw) {
    gw = new GatewayConnection();
    setGlobalGateway(gw);
  }
  return gw;
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
