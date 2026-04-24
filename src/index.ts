#!/usr/bin/env node

/**
 * OpenClaw Connector Main Entry Point
 *
 * Orchestrates startup of:
 * - Configuration loading
 * - Remote clients (operator connections to remote gateways)
 * - Node registrations (node connections to Gateway B)
 * - Bridge routing and command handlers
 */

import path from "path";
import { fileURLToPath } from "url";
import { loadConfig, getConnectorStateDir } from "./config.js";
import { createLogger } from "./logger.js";
import { RemoteClient } from "./remote-client.js";
import { NodeRegistration } from "./node-registration.js";
import { Bridge } from "./bridge.js";
import { COMMANDS, getCommandNames } from "./commands/index.js";
import { getDeviceIdentityPath, listRemoteDeviceIdentities } from "./device-identity-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger("connector");

async function main() {
  try {
    logger.info("Starting OpenClaw Connector", {
      version: "0.1.0",
      stateDir: getConnectorStateDir(),
    });

    // Load configuration
    const config = loadConfig();

    logger.info("Configuration loaded", {
      remoteCount: config.remotes.length,
      commandPolicy: (config.commandPolicy || { mode: "allow_all" }).mode,
      breakerEnabled: config.breaker?.enabled,
    });

    // Create bridge
    const bridge = new Bridge({
      commandPolicy: config.commandPolicy || { mode: "allow_all" },
      breakerConfig: config.breaker ?? {
        enabled: true,
        failureThreshold: 3,
        openMs: 15000,
        halfOpenMaxInFlight: 1,
      },
      logger,
    });

    // Register command handlers
    for (const command of COMMANDS) {
      bridge.registerCommand(command, command.handler);
    }

    logger.info("Registered commands", {
      commands: getCommandNames(),
    });

    // Create remote clients and node registrations
    const remoteClients: Map<string, RemoteClient> = new Map();
    const nodeRegistrations: Map<string, NodeRegistration> = new Map();
    const stateDir = getConnectorStateDir();

    for (const remote of config.remotes) {
      if (!remote.enabled) {
        logger.info("Skipping disabled remote", { remoteId: remote.id });
        continue;
      }

      const remoteClient = new RemoteClient({
        id: remote.id,
        url: remote.url,
        token: remote.token,
        password: remote.password,
        timeoutMs: remote.timeoutMs,
        logger,
      });

      remoteClients.set(remote.id, remoteClient);
      // Pass per-remote commandPolicy override if configured (PLAN Section 4.1)
      bridge.registerRemote(remote.id, remoteClient, remote.commandPolicy);

      // Create node registration for this remote
      const nodeId = `connector-${remote.id}`;
      const deviceIdentityPath = getDeviceIdentityPath(stateDir, remote.id);

      const nodeRegistration = new NodeRegistration({
        id: nodeId,
        displayName: remote.id,
        url: config.gatewayB.url,
        token: config.gatewayB.token,
        password: config.gatewayB.password,
        commands: getCommandNames(),
        logger,
        deviceIdentityPath,
        onInvoke: async (nodeIdParam, payload) => {
          return bridge.handleInvoke(nodeIdParam, payload);
        },
      });

      nodeRegistrations.set(remote.id, nodeRegistration);
      bridge.registerNode(nodeId, remote.id);
    }

    logger.info("Created remotes and nodes", {
      remoteCount: remoteClients.size,
      nodeCount: nodeRegistrations.size,
    });

    // Log device identity status
    const remoteIds = Array.from(config.remotes.filter((r) => r.enabled).map((r) => r.id));
    const identityStatus = listRemoteDeviceIdentities(stateDir, remoteIds);
    logger.info("Device identity status", {
      identities: identityStatus,
    });

    // Start all connections in parallel
    logger.info("Starting connections...");

    const startPromises: Promise<void>[] = [];

    for (const remoteClient of remoteClients.values()) {
      startPromises.push(remoteClient.start());
    }

    for (const nodeRegistration of nodeRegistrations.values()) {
      startPromises.push(nodeRegistration.start());
    }

    await Promise.all(startPromises);

    logger.info("All connections started");

    // Setup graceful shutdown
    const shutdown = async () => {
      logger.info("Shutting down gracefully...");

      const closePromises: Promise<void>[] = [];

      for (const remoteClient of remoteClients.values()) {
        closePromises.push(remoteClient.close());
      }

      for (const nodeRegistration of nodeRegistrations.values()) {
        closePromises.push(nodeRegistration.close());
      }

      await Promise.all(closePromises);

      logger.info("Shutdown complete");
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    // Keep process alive
    logger.info("Connector ready and listening for invokes");
    await new Promise(() => {
      // Never resolves - process stays alive
    });
  } catch (err) {
    logger.error("Fatal error", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
  }
}

void main();
