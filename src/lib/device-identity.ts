import { generateKeyPairSync, sign, createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync, chmodSync } from "fs";
import { join } from "path";
import { platform } from "os";
import { getCastleDir, ensureCastleDir } from "./config";

// ============================================================================
// Types
// ============================================================================

export interface DeviceIdentity {
  deviceId: string;
  publicKey: string;   // PEM-encoded Ed25519 public key
  privateKey: string;  // PEM-encoded Ed25519 private key
  createdAt: string;   // ISO-8601
  deviceToken?: string;
  pairedAt?: string;   // ISO-8601
  gatewayUrl?: string;
}

export interface DeviceInfo {
  deviceId: string;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
  isPaired: boolean;
  pairedAt?: string;
  gatewayUrl?: string;
}

// ============================================================================
// Paths
// ============================================================================

function getDevicePath(): string {
  return join(getCastleDir(), "device.json");
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a stored key is PEM format (vs old hex format).
 */
function isPem(key: string): boolean {
  return key.startsWith("-----BEGIN ");
}

/**
 * Derive device ID from public key per Gateway protocol.
 * Gateway expects: SHA-256 hash of raw Ed25519 public key bytes, hex-encoded.
 *
 * The PEM contains a DER-encoded SPKI structure:
 *   [12 bytes algorithm info] + [32 bytes raw Ed25519 key]
 */
function deriveDeviceId(publicKeyPem: string): string {
  const base64 = publicKeyPem
    .split("\n")
    .filter(line => !line.includes("BEGIN") && !line.includes("END") && line.trim())
    .join("");
  const der = Buffer.from(base64, "base64");
  // SPKI for Ed25519: 12-byte header + 32-byte raw key
  const rawPublicKey = der.slice(12);
  return createHash("sha256").update(rawPublicKey).digest("hex");
}

/**
 * Write identity to disk with restrictive permissions.
 */
let _windowsPermWarnShown = false;

function persistIdentity(identity: DeviceIdentity): void {
  const devicePath = getDevicePath();
  ensureCastleDir();
  writeFileSync(devicePath, JSON.stringify(identity, null, 2), "utf-8");

  if (platform() === "win32") {
    // chmod is a no-op on Windows — warn once
    if (!_windowsPermWarnShown) {
      console.warn("[Device] Warning: On Windows, device.json file permissions cannot be restricted.");
      console.warn("[Device] Keep your user account secure to protect your device private key.");
      _windowsPermWarnShown = true;
    }
  } else {
    try {
      chmodSync(devicePath, 0o600);
    } catch {
      // Ignore — may fail on some filesystems
    }
  }
}

// ============================================================================
// Core API
// ============================================================================

/**
 * Load existing device identity or generate a new Ed25519 keypair.
 * Keys are stored in PEM format as required by the Gateway protocol.
 * Identity is persisted in ~/.castle/device.json with mode 0600.
 */
export function getOrCreateIdentity(): DeviceIdentity {
  const devicePath = getDevicePath();

  // Try loading existing identity
  if (existsSync(devicePath)) {
    try {
      const raw = readFileSync(devicePath, "utf-8");
      const identity = JSON.parse(raw) as DeviceIdentity;
      if (identity.deviceId && identity.publicKey && identity.privateKey) {
        // Auto-upgrade: if keys are in old hex/DER format, regenerate entirely
        if (!isPem(identity.publicKey)) {
          console.log("[Device] Upgrading key format from hex to PEM — regenerating keypair");
          return generateIdentity();
        }
        // Auto-fix: if deviceId is a UUID instead of derived from public key, re-derive
        const expectedId = deriveDeviceId(identity.publicKey);
        if (identity.deviceId !== expectedId) {
          console.log("[Device] Fixing deviceId — deriving from public key per Gateway protocol");
          identity.deviceId = expectedId;
          persistIdentity(identity);
        }
        return identity;
      }
    } catch {
      // Corrupted file — regenerate
    }
  }

  return generateIdentity();
}

/**
 * Generate a new Ed25519 keypair and persist it.
 */
function generateIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const pubKeyStr = publicKey as unknown as string;

  const identity: DeviceIdentity = {
    deviceId: deriveDeviceId(pubKeyStr),
    publicKey: pubKeyStr,
    privateKey: privateKey as unknown as string,
    createdAt: new Date().toISOString(),
  };

  persistIdentity(identity);
  return identity;
}

/**
 * Parameters for signing a device auth payload.
 * Must match the Gateway's buildDeviceAuthPayload() format exactly.
 */
export interface DeviceAuthSignParams {
  nonce: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  token: string;
}

/**
 * Sign a device auth payload per the Gateway protocol.
 *
 * The Gateway builds a pipe-delimited string:
 *   v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce
 * and verifies the Ed25519 signature against that string.
 *
 * Returns { signature (base64url), signedAt (ms) }.
 */
export function signDeviceAuth(params: DeviceAuthSignParams): {
  signature: string;
  signedAt: number;
} {
  const identity = getOrCreateIdentity();
  const signedAt = Date.now();

  // Build the exact same payload string the Gateway builds
  const payload = [
    "v2",                          // version (v2 when nonce is present)
    identity.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(signedAt),
    params.token,
    params.nonce,
  ].join("|");

  // Ed25519 doesn't use a digest algorithm (pass null)
  const sig = sign(null, Buffer.from(payload, "utf-8"), identity.privateKey);

  // Gateway expects base64url encoding
  const signature = sig
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");

  return { signature, signedAt };
}

/**
 * Save a device token received after successful pairing.
 */
export function saveDeviceToken(token: string, gatewayUrl?: string): void {
  const identity = getOrCreateIdentity();
  identity.deviceToken = token;
  identity.pairedAt = new Date().toISOString();
  if (gatewayUrl) {
    identity.gatewayUrl = gatewayUrl;
  }
  persistIdentity(identity);
}

/**
 * Get the saved device token, or null if not yet paired.
 */
export function getDeviceToken(): string | null {
  const devicePath = getDevicePath();
  if (!existsSync(devicePath)) return null;

  try {
    const raw = readFileSync(devicePath, "utf-8");
    const identity = JSON.parse(raw) as DeviceIdentity;
    return identity.deviceToken || null;
  } catch {
    return null;
  }
}

/**
 * Clear the saved device token without deleting the identity.
 * Used when a device token is rejected (e.g. Gateway was reset).
 * The device keypair is preserved so it can re-pair.
 */
export function clearDeviceToken(): void {
  const devicePath = getDevicePath();
  if (!existsSync(devicePath)) return;

  try {
    const raw = readFileSync(devicePath, "utf-8");
    const identity = JSON.parse(raw) as DeviceIdentity;
    delete identity.deviceToken;
    delete identity.pairedAt;
    delete identity.gatewayUrl;
    persistIdentity(identity);
    console.log("[Device] Cleared device token");
  } catch {
    // If we can't read/parse, nothing to clear
  }
}

/**
 * Delete device identity entirely. Forces re-pairing on next connection.
 */
export function resetIdentity(): boolean {
  const devicePath = getDevicePath();
  if (existsSync(devicePath)) {
    unlinkSync(devicePath);
    return true;
  }
  return false;
}

/**
 * Get a summary of device identity for display (no private key).
 */
export function getDeviceInfo(): DeviceInfo | null {
  const devicePath = getDevicePath();
  if (!existsSync(devicePath)) return null;

  try {
    const raw = readFileSync(devicePath, "utf-8");
    const identity = JSON.parse(raw) as DeviceIdentity;

    // Create a fingerprint from the public key
    const fingerprint = createHash("sha256")
      .update(identity.publicKey)
      .digest("hex")
      .slice(0, 16);

    return {
      deviceId: identity.deviceId,
      publicKey: identity.publicKey,
      fingerprint,
      createdAt: identity.createdAt,
      isPaired: !!identity.deviceToken,
      pairedAt: identity.pairedAt,
      gatewayUrl: identity.gatewayUrl,
    };
  } catch {
    return null;
  }
}
