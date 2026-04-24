/**
 * Structured logging with JSON output and sensitive data masking
 */

import type { ILogger } from "./types.js";

const SENSITIVE_KEYS = new Set([
  "token",
  "password",
  "secret",
  "apikey",
  "auth",
  "authorization",
  "credential",
]);

function maskSensitiveFields(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => maskSensitiveFields(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = "***";
    } else if (typeof value === "object") {
      result[key] = maskSensitiveFields(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class StructuredLogger implements ILogger {
  private tag: string;

  constructor(tag: string = "connector") {
    this.tag = tag;
  }

  private formatLog(level: string, msg: string, meta?: Record<string, unknown>) {
    const log = {
      ts: new Date().toISOString(),
      level,
      tag: this.tag,
      msg,
      ...(meta && { meta: maskSensitiveFields(meta) }),
    };
    console.log(JSON.stringify(log));
  }

  debug(msg: string, meta?: Record<string, unknown>) {
    this.formatLog("DEBUG", msg, meta);
  }

  info(msg: string, meta?: Record<string, unknown>) {
    this.formatLog("INFO", msg, meta);
  }

  warn(msg: string, meta?: Record<string, unknown>) {
    this.formatLog("WARN", msg, meta);
  }

  error(msg: string, meta?: Record<string, unknown>) {
    this.formatLog("ERROR", msg, meta);
  }

  logEvent(event: string, fields: Record<string, unknown>) {
    const masked = maskSensitiveFields(fields);
    const log = {
      ts: new Date().toISOString(),
      level: "INFO",
      tag: this.tag,
      event,
      ...(typeof masked === "object" && masked !== null ? masked : {}),
    };
    console.log(JSON.stringify(log));
  }
}

export function createLogger(tag?: string): ILogger {
  return new StructuredLogger(tag);
}
