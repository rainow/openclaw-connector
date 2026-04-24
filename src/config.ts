/**
 * Configuration loading and validation
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import type { CircuitBreakerConfig, CommandPolicy, ConnectorConfig } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CommandPolicySchema = z.object({
  mode: z.enum(["allow_all", "allow_list"]).default("allow_all"),
  allowList: z.array(z.string()).optional(),
});

const CircuitBreakerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  failureThreshold: z.number().int().min(1).default(3),
  openMs: z.number().int().min(100).default(15000),
  halfOpenMaxInFlight: z.number().int().min(1).default(1),
});

const RemoteGatewayConfigSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  token: z.string().optional(),
  password: z.string().optional(),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().min(100).default(30000),
  commandPolicy: CommandPolicySchema.optional(),
});

const GatewayBConfigSchema = z.object({
  url: z.string().url(),
  token: z.string().optional(),
  password: z.string().optional(),
});

const ConnectorConfigSchema = z.object({
  gatewayB: GatewayBConfigSchema,
  commandPolicy: CommandPolicySchema.optional(),
  breaker: CircuitBreakerConfigSchema.optional(),
  remotes: z.array(RemoteGatewayConfigSchema),
});

function resolveEnvVar(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("${") && value.endsWith("}")) {
    const envKey = value.slice(2, -1);
    return process.env[envKey];
  }
  return value;
}

function applyEnvSubstitution(obj: unknown): unknown {
  if (typeof obj === "string") {
    return resolveEnvVar(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => applyEnvSubstitution(item));
  }
  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = applyEnvSubstitution(value);
    }
    return result;
  }
  return obj;
}

export function loadConfig(configPath?: string): ConnectorConfig {
  let rawConfig: unknown;

  if (!configPath) {
    // Try to find config file
    const possiblePaths = [
      "connector.config.json",
      path.join(process.cwd(), "connector.config.json"),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        configPath = p;
        break;
      }
    }

    if (!configPath) {
      throw new Error(
        "No config file found. Please provide connector.config.json or pass --config <path>"
      );
    }
  }

  const content = fs.readFileSync(configPath, "utf-8");
  rawConfig = JSON.parse(content);

  // Apply environment variable substitution
  rawConfig = applyEnvSubstitution(rawConfig);

  // Validate and parse
  const result = ConnectorConfigSchema.parse(rawConfig);

  // Fill in defaults for remotes
  const defaultCommandPolicy: CommandPolicy = result.commandPolicy || { mode: "allow_all" };
  const defaultBreaker: CircuitBreakerConfig = result.breaker || {
    enabled: true,
    failureThreshold: 3,
    openMs: 15000,
    halfOpenMaxInFlight: 1,
  };

  const normalizedRemotes = result.remotes.map((remote) => ({
    ...remote,
    commandPolicy: remote.commandPolicy || defaultCommandPolicy,
  }));

  return {
    ...result,
    commandPolicy: defaultCommandPolicy,
    breaker: defaultBreaker,
    remotes: normalizedRemotes,
  };
}

export function getConnectorStateDir(): string {
  const baseDir = process.env.CONNECTOR_STATE_DIR || path.join(process.env.HOME || "~", ".openclaw-connector");
  return baseDir;
}
