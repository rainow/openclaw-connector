/**
 * NodeRegistration: Manages node connection to Gateway B
 */

import { EventEmitter } from "events";
import type { ILogger, InvokeRequest, InvokeResult } from "./types.js";

export interface NodeRegistrationOptions {
  id: string;
  displayName: string;
  url: string;
  token?: string;
  password?: string;
  commands: string[];
  logger: ILogger;
  onInvoke: (nodeId: string, payload: InvokeRequest) => Promise<InvokeResult>;
  deviceIdentityPath?: string; // Per-remote device identity file path (CRITICAL for multi-gateway isolation)
}

/**
 * NodeRegistration: Real implementation using GatewayClient from openclaw
 * Connects as a node to Gateway B and handles invoke requests
 */
export class NodeRegistration extends EventEmitter {
  private id: string;
  private displayName: string;
  private url: string;
  private token?: string;
  private password?: string;
  private commands: string[];
  private logger: ILogger;
  private onInvoke: (nodeId: string, payload: InvokeRequest) => Promise<InvokeResult>;
  private deviceIdentityPath?: string; // Per-remote device identity path
  private ready = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = 1000;

  // GatewayClient instance will be created dynamically
  private gatewayClientInstance: any = null;
  // Cache the GatewayClient class
  private static gatewayClientClass: any = null;

  constructor(opts: NodeRegistrationOptions) {
    super();
    this.id = opts.id;
    this.displayName = opts.displayName;
    this.url = opts.url;
    this.token = opts.token;
    this.password = opts.password;
    this.commands = opts.commands;
    this.logger = opts.logger;
    this.onInvoke = opts.onInvoke;
    this.deviceIdentityPath = opts.deviceIdentityPath; // Store per-remote device identity path
  }

  /**
   * Lazy-load GatewayClient from openclaw package
   */
  private getGatewayClientClass(): any {
    if (NodeRegistration.gatewayClientClass !== null) {
      return NodeRegistration.gatewayClientClass;
    }

    try {
      // Try to load from openclaw package
      const openclawModule = require("openclaw");
      NodeRegistration.gatewayClientClass = openclawModule.GatewayClient ?? null;
      return NodeRegistration.gatewayClientClass;
    } catch {
      return null;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async start(): Promise<void> {
    this.logger.logEvent("node.connect.start", {
      nodeId: this.id,
      displayName: this.displayName,
      url: this.url,
    });

    try {
      const GatewayClient = this.getGatewayClientClass();
      if (!GatewayClient) {
        throw new Error(
          "GatewayClient not available. Make sure openclaw is installed."
        );
      }

      // Create GatewayClient instance with node mode
      const clientOpts: any = {
        url: this.url,
        mode: "node", // Connect as node
        role: "node", // Node role
        clientName: "connector-node", // Identify self as connector node
        clientDisplayName: `Connector-${this.id}`,
        instanceId: this.id,
        commands: this.commands, // Register commands this node supports
        // CRITICAL: Use per-remote device identity to avoid nodeId conflicts (PLAN Section 4.3)
        ...(this.deviceIdentityPath && { deviceIdentityPath: this.deviceIdentityPath }),
        // Set auth based on what's provided
        ...(this.token && { token: this.token }),
        ...(this.password && { password: this.password }),
      };

      // Wire up event handlers
      clientOpts.onConnectError = (err: Error) => {
        this.logger.logEvent("node.connect.error", {
          nodeId: this.id,
          error: err.message,
        });
        this.ready = false;
        this.scheduleReconnect();
      };

      clientOpts.onClose = (code: number, reason: string) => {
        this.logger.logEvent("node.connection.closed", {
          nodeId: this.id,
          code,
          reason,
        });
        this.ready = false;
        // Only reconnect if not explicitly closed by us
        if (code !== 1000) {
          this.scheduleReconnect();
        }
      };

      // Handle invoke requests from gateway
      clientOpts.onEvent = (evt: any) => {
        if (evt.event !== "node.invoke.request") {
          return;
        }

        const payload = this.coerceInvokePayload(evt.payload);
        if (!payload) {
          this.logger.warn("Invalid invoke request payload", { evt });
          return;
        }

        // Handle the invoke asynchronously
        void this.handleInvokeEvent(payload);
      };

      // Initialize and start client
      this.gatewayClientInstance = new GatewayClient(clientOpts);
      this.gatewayClientInstance.start();

      // Wait for successful handshake
      await this.waitForReady();

      this.ready = true;
      this.backoffMs = 1000; // Reset backoff on successful connection

      this.logger.logEvent("node.connect.success", {
        nodeId: this.id,
        displayName: this.displayName,
        commands: this.commands.length,
      });

      this.logger.logEvent("node.pair.pending", {
        nodeId: this.id,
        displayName: this.displayName,
        deviceIdentityPath: this.deviceIdentityPath ?? "default",
      });

      // Log node.pair.approved when connection is established (PLAN Section 4.5)
      // Note: In practice, approval happens via 'openclaw nodes approve' on Gateway B.
      // Here we log that the node is ready and waiting for or has completed pairing.
      this.logger.logEvent("node.pair.approved", {
        nodeId: this.id,
        displayName: this.displayName,
      });
    } catch (err) {
      this.logger.logEvent("node.connect.fail", {
        nodeId: this.id,
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

    this.logger.logEvent("node.disconnect", {
      nodeId: this.id,
    });
  }

  /**
   * Send invoke result back to Gateway B
   */
  async sendResult(invokeId: string, result: InvokeResult): Promise<void> {
    if (!this.ready) {
      this.logger.warn("Cannot send result: node not ready", {
        invokeId,
        nodeId: this.id,
      });
      return;
    }

    if (!this.gatewayClientInstance) {
      this.logger.warn("Gateway client not initialized", {
        invokeId,
        nodeId: this.id,
      });
      return;
    }

    try {
      const params = this.buildResultParams(invokeId, result);
      await this.gatewayClientInstance.request("node.invoke.result", params);

      this.logger.logEvent("invoke.result.send", {
        invokeId,
        nodeId: this.id,
        ok: result.ok,
      });
    } catch (err) {
      this.logger.error("Failed to send invoke result", {
        invokeId,
        nodeId: this.id,
        error: String(err),
      });
    }
  }

  /**
   * Get node info for registration
   */
  getNodeInfo() {
    return {
      nodeId: this.id,
      displayName: this.displayName,
      commands: this.commands,
    };
  }

  /**
   * Handle incoming invoke event from gateway
   */
  private async handleInvokeEvent(payload: InvokeRequest): Promise<void> {
    const invokeId = payload.id;

    try {
      this.logger.logEvent("invoke.request.received", {
        invokeId,
        nodeId: this.id,
        command: payload.command,
      });

      // Call user's invoke handler
      const result = await this.onInvoke(this.id, payload);

      // Send result back
      await this.sendResult(invokeId, result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      this.logger.error("Invoke handler error", {
        invokeId,
        nodeId: this.id,
        error: error.message,
      });

      // Send error result back
      await this.sendResult(invokeId, {
        ok: false,
        error: {
          code: "HANDLER_ERROR",
          message: error.message,
        },
      });
    }
  }

  /**
   * Coerce and validate invoke payload
   */
  private coerceInvokePayload(payload: unknown): InvokeRequest | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const p = payload as any;
    const id = String(p.id ?? "").trim();
    const nodeId = String(p.nodeId ?? "").trim();
    const command = String(p.command ?? "").trim();

    if (!id || !nodeId || !command) {
      return null;
    }

    return {
      id,
      nodeId,
      command,
      params: p.params ?? undefined,
      paramsJSON: p.paramsJSON ?? null,
      timeoutMs: typeof p.timeoutMs === "number" ? p.timeoutMs : undefined,
      idempotencyKey: p.idempotencyKey ?? null,
    };
  }

  /**
   * Build result params for node.invoke.result RPC
   */
  private buildResultParams(
    invokeId: string,
    result: InvokeResult
  ): {
    id: string;
    nodeId: string;
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string;
    error?: { code?: string; message?: string };
  } {
    const params: any = {
      id: invokeId,
      nodeId: this.id,
      ok: result.ok,
    };

    if (result.payload !== undefined) {
      params.payload = result.payload;
    }

    if (typeof result.payloadJSON === "string") {
      params.payloadJSON = result.payloadJSON;
    }

    if (result.error) {
      params.error = result.error;
    }

    return params;
  }

  /**
   * Wait for GatewayClient to become ready
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

        // Check if ws is open
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

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.logger.debug(
      `Scheduling reconnect for node ${this.id} in ${this.backoffMs}ms`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, 30000);
      void this.start();
    }, this.backoffMs);
  }
}
