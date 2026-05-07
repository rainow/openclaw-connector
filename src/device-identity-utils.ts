/**
 * Device Identity Utilities
 * 
 * Cryptographic operations for Ed25519-based device identity and signing.
 * Adapted from OpenClaw's device-identity.ts implementation.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type DeviceIdentity = {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
};

type StoredIdentity = {
  version: 1;
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAtMs: number;
};

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Base64-URL encode: standard base64 with URL-safe characters and no padding
 */
function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

/**
 * Base64-URL decode with padding restoration
 */
function base64UrlDecode(input: string): Buffer {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

/**
 * Extract raw Ed25519 public key (32 bytes) from PEM format
 */
function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" }) as Buffer;
  // For Ed25519, the SPKI format is: ED25519_SPKI_PREFIX (12 bytes) + raw public key (32 bytes)
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

/**
 * Generate deviceId: SHA-256 fingerprint of the public key
 */
function fingerprintPublicKey(publicKeyPem: string): string {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Generate a new Ed25519 key pair and wrap as DeviceIdentity
 */
function generateIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const deviceId = fingerprintPublicKey(publicKeyPem);
  return { deviceId, publicKeyPem, privateKeyPem };
}

/**
 * Ensure parent directory exists
 */
function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

/**
 * Load device identity from file or create new one if it doesn't exist
 * 
 * @param filePath - Path to the device identity file
 * @returns Loaded or newly generated DeviceIdentity
 */
export function loadOrCreateDeviceIdentity(filePath: string): DeviceIdentity {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredIdentity;
      
      if (
        parsed?.version === 1 &&
        typeof parsed.deviceId === "string" &&
        typeof parsed.publicKeyPem === "string" &&
        typeof parsed.privateKeyPem === "string"
      ) {
        // Verify deviceId matches the public key fingerprint
        const derivedId = fingerprintPublicKey(parsed.publicKeyPem);
        if (derivedId && derivedId !== parsed.deviceId) {
          // Update if fingerprint changed
          const updated: StoredIdentity = {
            ...parsed,
            deviceId: derivedId,
          };
          fs.writeFileSync(filePath, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
          try {
            fs.chmodSync(filePath, 0o600);
          } catch {
            // best-effort chmod
          }
          return {
            deviceId: derivedId,
            publicKeyPem: parsed.publicKeyPem,
            privateKeyPem: parsed.privateKeyPem,
          };
        }
        
        return {
          deviceId: parsed.deviceId,
          publicKeyPem: parsed.publicKeyPem,
          privateKeyPem: parsed.privateKeyPem,
        };
      }
    }
  } catch {
    // Fall through to generate new identity
  }

  // Generate new identity and save
  const identity = generateIdentity();
  ensureDir(filePath);
  const stored: StoredIdentity = {
    version: 1,
    deviceId: identity.deviceId,
    publicKeyPem: identity.publicKeyPem,
    privateKeyPem: identity.privateKeyPem,
    createdAtMs: Date.now(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort chmod
  }

  return identity;
}

/**
 * Sign payload using Ed25519 private key
 * 
 * @param privateKeyPem - Private key in PEM format
 * @param payload - String payload to sign
 * @returns Base64-URL encoded signature
 */
export function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(sig);
}

/**
 * Convert PEM-format public key to Base64-URL raw format (32 bytes for Ed25519)
 * 
 * @param publicKeyPem - Public key in PEM format
 * @returns Base64-URL encoded raw public key
 */
export function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

/**
 * Build device authentication payload for v3 protocol
 * 
 * Format: v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily
 * This payload is then signed with the device's private key.
 */
export function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
  platform?: string | null;
  deviceFamily?: string | null;
}): string {
  const scopes = params.scopes.join(",");
  const token = params.token ?? "";
  const platform = params.platform?.trim() || "";
  const deviceFamily = params.deviceFamily?.trim() || "";
  
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce,
    platform,
    deviceFamily,
  ].join("|");
}
