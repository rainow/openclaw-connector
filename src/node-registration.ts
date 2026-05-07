/**
 * NodeRegistration: Manages node connection to Gateway B
 */

import { EventEmitter } from "events";
import type { ILogger, InvokeRequest, InvokeResult } from "./types.js";
import { GatewayClientLite, type GatewayClientOptions } from "./gateway-client-lite.js";
import { loadOrCreateDeviceIdentity } from "./device-identity-utils.js";

export interface NodeRegistrationOptions {
  id: string;
  displayName: string;
  url: string;
  token?: string;
  password?: string;
  cookie?: string;
  commands: string[];
  logger: ILogger;
  onInvoke: (nodeId: string, payload: InvokeRequest) => Promise<InvokeResult>;
  deviceIdentityPath?: string; // Per-remote device identity file path (CRITICAL for multi-gateway isolation)
}

/**
 * NodeRegistration: Real implementation using GatewayClientLite
 * Connects as a node to Gateway B and handles invoke requests
 */

export class NodeRegistration extends EventEmitter {
  private id: string;
  private displayName: string;
  private url: string;
  private token?: string;
  private password?: string;
  private cookie?: string;
  private commands: string[];
  private logger: ILogger;
  private onInvoke: (nodeId: string, payload: InvokeRequest) => Promise<InvokeResult>;
  private deviceIdentityPath?: string; // Per-remote device identity path
  private ready = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = 1000;

  // GatewayClientLite instance
  private gatewayClientInstance: GatewayClientLite | null = null;

  constructor(opts: NodeRegistrationOptions) {
    super();
    this.id = opts.id;
    this.displayName = opts.displayName;
    this.url = opts.url;
    this.token = opts.token;
    this.password = opts.password;
    this.cookie = opts.cookie;
    this.commands = opts.commands;
    this.logger = opts.logger;
    this.onInvoke = opts.onInvoke;
    this.deviceIdentityPath = opts.deviceIdentityPath; // Store per-remote device identity path
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
      // Load or create device identity for this node
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

      // Strategy: Declare ONLY the commands that make sense to call via nodes.invoke
      // We filter out "nodes.*" commands since they refer to the local gateway's nodes,
      // which doesn't make sense when called from a remote gateway
      // Valid commands: sessions.list, sessions.send, gateway.status
      const validNodeCommands = this.commands.filter(
        cmd => !cmd.startsWith("nodes.")
      );

      const clientOpts: GatewayClientOptions = {
        url: this.url,
        requestTimeoutMs: 30000,
        role: "node",  // NodeRegistration connects as a node to register commands
        // Set auth based on what's provided
        ...(this.token && { token: this.token }),
        ...(this.password && { password: this.password }),
        ...(this.cookie && { cookie: this.cookie }),
        ...(deviceIdentity && { deviceIdentity }),
        commands: validNodeCommands,  // Only non-node commands
        caps: this.commands,  // Full capabilities documentation
        permissions: undefined,
        pathEnv: undefined,
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
        // Log all events for debugging
        this.logger.debug("Received gateway event", {
          event: evt.event,
          nodeId: this.id,
        });

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
      this.gatewayClientInstance = new GatewayClientLite(clientOpts);
      
      // Wait for connection event
      await new Promise<void>((resolve, reject) => {
        if (!this.gatewayClientInstance) {
          reject(new Error("GatewayClientLite not created"));
          return;
        }

        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout after 30000ms"));
        }, 30000);

        // Listen for connection event
        this.gatewayClientInstance.on("connected", () => {
          clearTimeout(timeout);
          resolve();
        });

        this.gatewayClientInstance.start();
      });

      this.ready = true;
      this.backoffMs = 1000; // Reset backoff on successful connection

      this.logger.logEvent("node.connect.success", {
        nodeId: this.id,
        displayName: this.displayName,
        commands: this.commands.length,
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
        this.gatewayClientInstance.stop();
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
   * Note: Must use the nodeId from the original invoke request, not this.id
   */
  async sendResult(invokeId: string, result: InvokeResult, requestNodeId?: string): Promise<void> {
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
      const params = this.buildResultParams(invokeId, result, requestNodeId);
      await this.gatewayClientInstance.request("node.invoke.result", params);

      this.logger.logEvent("invoke.result.send", {
        invokeId,
        nodeId: requestNodeId ?? this.id,
        ok: result.ok,
      });
    } catch (err) {
      this.logger.error("Failed to send invoke result", {
        invokeId,
        nodeId: requestNodeId ?? this.id,
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
    const requestNodeId = payload.nodeId;  // Original nodeId from Gateway request

    try {
      this.logger.logEvent("invoke.request.received", {
        invokeId,
        nodeId: requestNodeId,
        command: payload.command,
      });

      // Call user's invoke handler (pass this.id for routing, but track the request's nodeId)
      const result = await this.onInvoke(this.id, payload);

      // Send result back with the original request's nodeId
      await this.sendResult(invokeId, result, requestNodeId);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      this.logger.error("Invoke handler error", {
        invokeId,
        nodeId: requestNodeId,
        error: error.message,
      });

      // Send error result back with the original request's nodeId
      await this.sendResult(invokeId, {
        ok: false,
        error: {
          code: "HANDLER_ERROR",
          message: error.message,
        },
      }, requestNodeId);
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
   * CRITICAL: nodeId must match the original request's nodeId (from Gateway),
   * not our local this.id. This ensures Gateway's nodeId validation passes.
   */
  private buildResultParams(
    invokeId: string,
    result: InvokeResult,
    requestNodeId?: string
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
      nodeId: requestNodeId ?? this.id,  // Use request nodeId if available, fallback to this.id
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
