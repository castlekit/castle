import { generateKeyPairSync, sign, createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync, chmodSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { getCastleDir, ensureCastleDir } from "./config";

// ============================================================================
// Types
// ============================================================================

export interface DeviceIdentity {
  deviceId: string;
  publicKey: string;   // hex-encoded Ed25519 public key
  privateKey: string;  // hex-encoded Ed25519 private key
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
// Core API
// ============================================================================

/**
 * Load existing device identity or generate a new Ed25519 keypair.
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
        return identity;
      }
    } catch {
      // Corrupted file — regenerate
    }
  }

  // Generate new Ed25519 keypair
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });

  const identity: DeviceIdentity = {
    deviceId: randomUUID(),
    publicKey: publicKey.toString("hex"),
    privateKey: privateKey.toString("hex"),
    createdAt: new Date().toISOString(),
  };

  // Persist with restrictive permissions
  ensureCastleDir();
  writeFileSync(devicePath, JSON.stringify(identity, null, 2), "utf-8");
  try {
    chmodSync(devicePath, 0o600);
  } catch {
    // chmod may not work on all platforms (Windows)
  }

  return identity;
}

/**
 * Sign a challenge nonce with the device's Ed25519 private key.
 * Returns a base64-encoded signature.
 */
export function signChallenge(nonce: string): string {
  const identity = getOrCreateIdentity();
  const privateKeyDer = Buffer.from(identity.privateKey, "hex");

  // Reconstruct the private key object from DER
  const privateKey = {
    key: privateKeyDer,
    format: "der" as const,
    type: "pkcs8" as const,
  };

  const signature = sign(null, Buffer.from(nonce, "utf-8"), privateKey);
  return signature.toString("base64");
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

  const devicePath = getDevicePath();
  writeFileSync(devicePath, JSON.stringify(identity, null, 2), "utf-8");
  try {
    chmodSync(devicePath, 0o600);
  } catch {
    // chmod may not work on all platforms
  }
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

    // Create a fingerprint from the public key (first 16 chars of SHA-256)
    const fingerprint = createHash("sha256")
      .update(Buffer.from(identity.publicKey, "hex"))
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
