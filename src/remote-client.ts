/**
 * RemoteClient: Manages operator connection to a remote Gateway
 */

import { EventEmitter } from "events";
import type { ILogger, IRemoteClient } from "./types.js";

export interface RemoteClientOptions {
  id: string;
  url: string;
  token?: string;
  password?: string;
  timeoutMs?: number;
  logger: ILogger;
}

/**
 * RemoteClient: Real implementation using GatewayClient from openclaw
 * Connects as an operator to a remote Gateway and proxies requests
 */
export class RemoteClient extends EventEmitter implements IRemoteClient {
  private id: string;
  private url: string;
  private token?: string;
  private password?: string;
  private timeoutMs: number;
  private logger: ILogger;
  private ready = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = 1000;
  
  // GatewayClient instance will be created dynamically
  private gatewayClientInstance: any = null;
  // Cache the GatewayClient class
  private static gatewayClientClass: any = null;

  constructor(opts: RemoteClientOptions) {
    super();
    this.id = opts.id;
    this.url = opts.url;
    this.token = opts.token;
    this.password = opts.password;
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.logger = opts.logger;
  }

  /**
   * Lazy-load GatewayClient from openclaw package
   * Returns null if openclaw is not available
   */
  private getGatewayClientClass(): any {
    if (RemoteClient.gatewayClientClass !== null) {
      return RemoteClient.gatewayClientClass;
    }

    try {
      // Try to load from openclaw package
      const openclawModule = require("openclaw");
      RemoteClient.gatewayClientClass = openclawModule.GatewayClient ?? null;
      return RemoteClient.gatewayClientClass;
    } catch {
      // openclaw not available
      return null;
    }
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
      const GatewayClient = this.getGatewayClientClass();
      if (!GatewayClient) {
        throw new Error(
          "GatewayClient not available. Make sure openclaw is installed."
        );
      }

      // Create GatewayClient instance with operator mode
      const clientOpts: any = {
        url: this.url,
        mode: "operator", // Connect as operator
        clientName: "connector", // Identify self as connector
        clientDisplayName: `Connector-${this.id}`,
        timeoutMs: this.timeoutMs,
        // Set auth based on what's provided
        ...(this.token && { token: this.token }),
        ...(this.password && { password: this.password }),
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
      this.gatewayClientInstance = new GatewayClient(clientOpts);
      this.gatewayClientInstance.start();

      // Wait for successful handshake
      await this.waitForReady();

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
        await this.gatewayClientInstance.stop();
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
   * Wait for GatewayClient to become ready
   * Uses a simple polling mechanism with timeout
   */
  private async waitForReady(): Promise<void> {
    const maxWaitMs = 10000;
    const pollIntervalMs = 100;
    const startTime = Date.now();

    return new Promise<void>((resolve, reject) => {
      const poll = () => {
        if (!this.gatewayClientInstance) {
          reject(new Error("GatewayClient was destroyed"));
          return;
        }

        // Check if ws is open (GatewayClient connected)
        if (this.gatewayClientInstance.ws && this.gatewayClientInstance.ws.readyState === 1) {
          // WebSocket.OPEN = 1
          resolve();
          return;
        }

        const elapsed = Date.now() - startTime;
        if (elapsed > maxWaitMs) {
          reject(new Error(`Gateway client connect timeout after ${maxWaitMs}ms`));
          return;
        }

        setTimeout(poll, pollIntervalMs);
      };

      poll();
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
      const data = await (this.gatewayClientInstance.request as (method: string, params?: unknown, opts?: any) => Promise<T>)(
        method,
        params,
        { timeoutMs: timeoutMs ?? this.timeoutMs }
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
      if (err.message.includes("timeout")) return "TIMEOUT";
      if (err.message.includes("ECONNREFUSED")) return "CONNECTION_REFUSED";
      if (err.message.includes("ENOTFOUND")) return "NETWORK_ERROR";
      if ("code" in err) return String(err.code);
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
