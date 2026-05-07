/**
 * Device Identity Manager
 *
 * Manages per-remote device identity persistence and isolation.
 * Each remote gets its own deviceIdentity file to avoid nodeId conflicts.
 */

import fs from "fs";
import path from "path";

/**
 * Get the device identity file path for a specific remote
 *
 * @param stateDir - Connector state directory (e.g., ~/.openclaw/connector-state)
 * @param remoteId - Unique remote gateway identifier
 * @returns Path to the device identity file for this remote
 *
 * Example:
 *   ~/.openclaw/connector-state/device-identities/device-machine-a.json
 *   ~/.openclaw/connector-state/device-identities/device-office-srv.json
 */
export function getDeviceIdentityPath(stateDir: string, remoteId: string): string {
  const identityDir = path.join(stateDir, "device-identities");
  
  // Ensure directory exists
  if (!fs.existsSync(identityDir)) {
    fs.mkdirSync(identityDir, { recursive: true });
  }
  
  return path.join(identityDir, `device-${remoteId}.json`);
}

/**
 * Load or create device identity for a remote
 *
 * Each remote maintains its own device identity to ensure:
 * 1. No nodeId collisions
 * 2. Per-remote device token storage
 * 3. Isolated device pairing state
 *
 * @param stateDir - Connector state directory
 * @param remoteId - Unique remote gateway identifier
 * @returns Device identity (loaded from file or newly created)
 */
export function loadOrCreateRemoteDeviceIdentity(
  stateDir: string,
  remoteId: string
): unknown | null {
  const identityPath = getDeviceIdentityPath(stateDir, remoteId);

  // Try to load existing identity
  if (fs.existsSync(identityPath)) {
    try {
      const content = fs.readFileSync(identityPath, "utf-8");
      const identity = JSON.parse(content);
      return identity;
    } catch (err) {
      // Output structured error log (pure utility module, no logger injection)
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: "ERROR",
        tag: "device-identity-manager",
        msg: "Failed to load device identity",
        identityPath,
        error: err instanceof Error ? err.message : String(err),
      }));
      // Fall through to create new identity
    }
  }

  // Return null to allow GatewayClient to create device identity
  // GatewayClient will save it to the path we've set up
  return null;
}

/**
 * List all device identities for remotes
 *
 * Useful for monitoring and debugging per-remote device state
 *
 * @param stateDir - Connector state directory
 * @returns Array of {remoteId, identityPath, exists}
 */
export function listRemoteDeviceIdentities(
  stateDir: string,
  remoteIds: string[]
): Array<{ remoteId: string; identityPath: string; exists: boolean }> {
  return remoteIds.map((remoteId) => {
    const identityPath = getDeviceIdentityPath(stateDir, remoteId);
    return {
      remoteId,
      identityPath,
      exists: fs.existsSync(identityPath),
    };
  });
}

/**
 * Clear device identity for a remote
 *
 * Use this to reset a remote's pairing state (e.g., for re-pairing)
 *
 * @param stateDir - Connector state directory
 * @param remoteId - Unique remote gateway identifier
 * @returns true if identity was deleted, false if it didn't exist
 */
export function clearRemoteDeviceIdentity(stateDir: string, remoteId: string): boolean {
  const identityPath = getDeviceIdentityPath(stateDir, remoteId);

  if (fs.existsSync(identityPath)) {
    try {
      fs.unlinkSync(identityPath);
      return true;
    } catch (err) {
      // Output structured error log (pure utility module, no logger injection)
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: "ERROR",
        tag: "device-identity-manager",
        msg: "Failed to clear device identity",
        identityPath,
        error: err instanceof Error ? err.message : String(err),
      }));
      return false;
    }
  }

  return false;
}

/**
 * Get device identity stats
 *
 * Returns information about all device identities for monitoring
 *
 * @param stateDir - Connector state directory
 * @returns Object with stats about device identities
 */
export function getDeviceIdentityStats(stateDir: string): {
  totalCount: number;
  existingCount: number;
  missingCount: number;
  totalSize: number;
} {
  const identityDir = path.join(stateDir, "device-identities");

  if (!fs.existsSync(identityDir)) {
    return {
      totalCount: 0,
      existingCount: 0,
      missingCount: 0,
      totalSize: 0,
    };
  }

  const files = fs.readdirSync(identityDir);
  let totalSize = 0;

  for (const file of files) {
    if (file.startsWith("device-") && file.endsWith(".json")) {
      const filePath = path.join(identityDir, file);
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
    }
  }

  return {
    totalCount: files.filter((f) => f.startsWith("device-") && f.endsWith(".json")).length,
    existingCount: files.filter((f) => f.startsWith("device-") && f.endsWith(".json")).length,
    missingCount: 0, // All existing files count as existing
    totalSize,
  };
}
