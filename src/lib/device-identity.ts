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
 * Write identity to disk with restrictive permissions.
 */
function persistIdentity(identity: DeviceIdentity): void {
  const devicePath = getDevicePath();
  ensureCastleDir();
  writeFileSync(devicePath, JSON.stringify(identity, null, 2), "utf-8");
  try {
    chmodSync(devicePath, 0o600);
  } catch {
    // chmod may not work on all platforms (Windows)
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
        // Auto-upgrade: if keys are in old hex/DER format, regenerate with PEM
        if (!isPem(identity.publicKey)) {
          console.log("[Device] Upgrading key format from hex to PEM — regenerating keypair");
          // Keep the same deviceId but generate new PEM keys
          return generateIdentity(identity.deviceId);
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
function generateIdentity(existingDeviceId?: string): DeviceIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const identity: DeviceIdentity = {
    deviceId: existingDeviceId || randomUUID(),
    publicKey: publicKey as unknown as string,
    privateKey: privateKey as unknown as string,
    createdAt: new Date().toISOString(),
  };

  persistIdentity(identity);
  return identity;
}

/**
 * Sign a challenge nonce with the device's Ed25519 private key.
 * Returns a base64-encoded signature.
 */
export function signChallenge(nonce: string): string {
  const identity = getOrCreateIdentity();

  // Ed25519 doesn't use a digest algorithm (pass null)
  const signature = sign(
    null,
    Buffer.from(nonce, "utf-8"),
    identity.privateKey
  );
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
