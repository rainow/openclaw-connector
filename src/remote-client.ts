/**
 * RemoteClient: Manages operator connection to a remote Gateway
 */

import { EventEmitter } from "events";
import type { ILogger, IRemoteClient } from "./types.js";
import { GatewayClientLite, type GatewayClientOptions } from "./gateway-client-lite.js";
import { loadOrCreateDeviceIdentity } from "./device-identity-utils.js";

export interface RemoteClientOptions {
  id: string;
  url: string;
  token?: string;
  password?: string;
  cookie?: string;
  timeoutMs?: number;
  logger: ILogger;
  deviceIdentityPath?: string;
}

/**
 * RemoteClient: Real implementation using GatewayClientLite
 * Connects as an operator to a remote Gateway and proxies requests
 */

export class RemoteClient extends EventEmitter implements IRemoteClient {
  private id: string;
  private url: string;
  private token?: string;
  private password?: string;
  private cookie?: string;
  private timeoutMs: number;
  private logger: ILogger;
  private deviceIdentityPath?: string;
  private ready = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = 1000;
  
  // GatewayClientLite instance
  private gatewayClientInstance: GatewayClientLite | null = null;

  constructor(opts: RemoteClientOptions) {
    super();
    this.id = opts.id;
    this.url = opts.url;
    this.token = opts.token;
    this.password = opts.password;
    this.cookie = opts.cookie;
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.logger = opts.logger;
    this.deviceIdentityPath = opts.deviceIdentityPath;
  }

  isReady(): boolean {
    return this.ready;
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs?: number
  ): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }> {
    if (!this.ready) {
      return {
        ok: false,
        error: { code: "UNAVAILABLE", message: "remote gateway not connected" },
      };
    }

    const timeout = timeoutMs ?? this.timeoutMs;
    const startTime = Date.now();

    try {
      this.logger.logEvent("invoke.start", {
        remoteId: this.id,
        method,
        timeoutMs: timeout,
      });

      // Call actual GatewayClient.request()
       const result = await this.makeRequest<T>(method, params, timeout ?? this.timeoutMs);

      const durationMs = Date.now() - startTime;
      this.logger.logEvent("invoke.success", {
        remoteId: this.id,
        method,
        durationMs,
      });

      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorCode =
        err instanceof Error ? err.message : "UNKNOWN_ERROR";
      this.logger.logEvent("invoke.fail", {
        remoteId: this.id,
        method,
        errorCode,
        durationMs,
      });

      // Check if error is retryable
      const isRetryable =
        err instanceof Error && (err.message.includes("timeout") || err.message.includes("ECONNREFUSED"));

      if (isRetryable && !this.ready) {
        this.scheduleReconnect();
      }

      return {
        ok: false,
        error: {
          code: this.extractErrorCode(err),
          message: String(err),
        },
      };
    }
  }

  onConnectError(callback: (err: Error) => void): void {
    this.on("connectError", callback);
  }

  onClose(callback: (code: number, reason: string) => void): void {
    this.on("close", callback);
  }

  async start(): Promise<void> {
    this.logger.logEvent("remote.connect.start", {
      remoteId: this.id,
      url: this.url,
    });

    try {
      // Load or create device identity for this remote connection
      let deviceIdentity = undefined;
      if (this.deviceIdentityPath) {
        try {
          deviceIdentity = loadOrCreateDeviceIdentity(this.deviceIdentityPath);
          this.logger.debug(
            `Loaded device identity from ${this.deviceIdentityPath}: ${deviceIdentity.deviceId}`
          );
        } catch (err) {
          this.logger.debug(
            `Failed to load device identity from ${this.deviceIdentityPath}: ${String(err)}`
          );
          // Continue without device identity - it will use client.id as fallback
        }
      }

      const clientOpts: GatewayClientOptions = {
        url: this.url,
        requestTimeoutMs: this.timeoutMs,
        role: "operator",  // RemoteClient connects as an operator, not a node
        // Set auth based on what's provided
        ...(this.token && { token: this.token }),
        ...(this.password && { password: this.password }),
        ...(this.cookie && { cookie: this.cookie }),
        ...(deviceIdentity && { deviceIdentity }),
      };

      // Wire up event handlers
      clientOpts.onConnectError = (err: Error) => {
        this.logger.logEvent("remote.connect.error", {
          remoteId: this.id,
          error: err.message,
        });
        this.emit("connectError", err);
        this.ready = false;
        this.scheduleReconnect();
      };

      clientOpts.onClose = (code: number, reason: string) => {
        this.logger.logEvent("remote.connection.closed", {
          remoteId: this.id,
          code,
          reason,
        });
        this.emit("close", code, reason);
        this.ready = false;
        // Only reconnect if not explicitly closed by us
        if (code !== 1000) {
          this.scheduleReconnect();
        }
      };

      // Initialize and start client
      this.gatewayClientInstance = new GatewayClientLite(clientOpts);
      
      // Wait for connection event
      await new Promise<void>((resolve, reject) => {
        if (!this.gatewayClientInstance) {
          reject(new Error("GatewayClientLite not created"));
          return;
        }

        const timeout = setTimeout(() => {
          reject(new Error(`Connection timeout after ${this.timeoutMs}ms`));
        }, this.timeoutMs);

        // Listen for connection event
        this.gatewayClientInstance.on("connected", () => {
          clearTimeout(timeout);
          resolve();
        });

        this.gatewayClientInstance.start();
      });

      this.ready = true;
      this.backoffMs = 1000; // Reset backoff on successful connection

      this.logger.logEvent("remote.connect.success", {
        remoteId: this.id,
      });
    } catch (err) {
      this.logger.logEvent("remote.connect.fail", {
        remoteId: this.id,
        error: String(err),
      });

      this.ready = false;
      this.scheduleReconnect();
    }
  }

  async close(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ready = false;

    if (this.gatewayClientInstance) {
      try {
        this.gatewayClientInstance.stop();
      } catch (err) {
        this.logger.debug(`Error stopping gateway client: ${String(err)}`);
      }
      this.gatewayClientInstance = null;
    }

    this.logger.logEvent("remote.disconnect", {
      remoteId: this.id,
    });
  }

  /**
   * Make actual RPC request to remote gateway
   */
  private async makeRequest<T>(
    method: string,
    params?: unknown,
    timeoutMs?: number
  ): Promise<{ ok: boolean; data?: T }> {
    if (!this.gatewayClientInstance) {
      throw new Error("GatewayClient not initialized");
    }

    try {
      const data = await this.gatewayClientInstance.request<T>(
        method,
        params,
        timeoutMs ?? this.timeoutMs
      );

      return { ok: true, data };
    } catch (err) {
      // Re-throw to be handled by caller
      throw err;
    }
  }

  /**
   * Extract error code from various error types
   */
  private extractErrorCode(err: unknown): string {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes("timeout")) return "TIMEOUT";
      if (msg.includes("econnrefused") || msg.includes("refused")) return "CONNECTION_REFUSED";
      if (msg.includes("enotfound") || msg.includes("network")) return "NETWORK_ERROR";
      if ("code" in err && err.code) return String(err.code);
    }
    return "REQUEST_FAILED";
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.logger.debug(
      `Scheduling reconnect for ${this.id} in ${this.backoffMs}ms`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, 30000);
      void this.start();
    }, this.backoffMs);
  }
}
