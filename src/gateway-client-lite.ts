/**
 * Simplified GatewayClient for OpenClaw Connector
 * 
 * This is a lightweight implementation that focuses on:
 * - WebSocket connection with Cookie support
 * - Token-based authentication (CONNECT handshake)
 * - Request-response protocol handling
 * - Device identity and Ed25519 signatures (for node registration)
 * 
 * Derived from openclaw's GatewayClient but simplified for connector use case.
 */

import { EventEmitter } from "events";
import { WebSocket, type ClientOptions } from "ws";
import { randomUUID } from "node:crypto";
import type { DeviceIdentity } from "./device-identity-utils.js";
import {
  buildDeviceAuthPayloadV3,
  signDevicePayload,
  publicKeyRawBase64UrlFromPem,
} from "./device-identity-utils.js";

export interface GatewayClientOptions {
  url?: string;
  token?: string;
  password?: string;
  cookie?: string;
  deviceIdentity?: DeviceIdentity;
  role?: "operator" | "node"; // Connection role (default: "operator")
  clientId?: string; // Client ID for protocol (used in node.invoke.result validation)
  commands?: string[];
  caps?: string[];
  permissions?: Record<string, boolean>;
  pathEnv?: string;
  requestTimeoutMs?: number;
  onEvent?: (evt: EventFrame) => void;
  onConnectError?: (err: Error) => void;
  onClose?: (code: number, reason: string) => void;
}

export interface EventFrame {
  seq?: number;
  event: string;
  payload?: unknown;
}

export interface ResponseFrame {
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}

type Pending<T = unknown> = {
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  timeout: NodeJS.Timeout | null;
};

export class GatewayClientError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "GatewayClientError";
    this.code = code;
    this.details = details;
  }
}

export class GatewayClientLite extends EventEmitter {
  private ws: WebSocket | null = null;
  private opts: GatewayClientOptions;
  private pending = new Map<string, Pending<unknown>>();
  private closed = false;
  private connected = false;
  private socketOpened = false; // Track WebSocket open state
  private connectNonce: string | null = null;
  private connectSent = false;
  private role: "operator" | "node"; // Connection role
  private clientId: string; // Client ID for protocol
  private commands: string[] = [];
  private caps: string[] = [];
  private permissions?: Record<string, boolean>;
  private pathEnv?: string;
  private readonly requestTimeoutMs: number;

  constructor(opts: GatewayClientOptions) {
    super();
    this.opts = opts;
    this.clientId = opts.clientId ?? "gateway-client"; // Use provided clientId or default
    this.role = opts.role ?? "operator"; // Default to "operator"
    this.commands = opts.commands ?? [];
    this.caps = opts.caps ?? [];
    this.permissions = opts.permissions;
    this.pathEnv = opts.pathEnv;
    this.requestTimeoutMs =
      typeof opts.requestTimeoutMs === "number" && isFinite(opts.requestTimeoutMs)
        ? Math.max(1, Math.min(Math.floor(opts.requestTimeoutMs), 2_147_483_647))
        : 30_000;
  }

  /**
   * Start the WebSocket connection
   */
  start(): void {
    if (this.closed) {
      return;
    }

    const url = this.opts.url ?? "ws://127.0.0.1:18789";

    // Build WebSocket options with cookie support
    const wsOptions: ClientOptions = {
      maxPayload: 25 * 1024 * 1024, // 25MB - allow large responses like node screenshots
    };

    if (this.opts.cookie) {
      wsOptions.headers = { cookie: this.opts.cookie };
    }

    this.ws = new WebSocket(url, wsOptions);
    this.socketOpened = false;
    this.connectNonce = null;
    this.connectSent = false;
    this.connected = false;

    this.ws.on("open", () => {
      this.handleOpen();
    });

    this.ws.on("message", (data: Buffer | string) => {
      this.handleMessage(data);
    });

    this.ws.on("close", (code: number, reason: Buffer | string) => {
      this.handleClose(code, reason);
    });

    this.ws.on("error", (err: Error) => {
      this.handleError(err);
    });
  }

  /**
   * Stop the connection
   */
  stop(): void {
    this.closed = true;
    if (this.ws) {
      this.ws.close();
    }
    this.flushPendingErrors(new Error("gateway client stopped"));
  }

  /**
   * Send a request to the gateway
   */
  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs?: number
  ): Promise<T> {
    if (!this.connected) {
      throw new GatewayClientError(
        "UNAVAILABLE",
        "gateway client not connected"
      );
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new GatewayClientError(
        "UNAVAILABLE",
        "gateway client websocket closed"
      );
    }

    const id = randomUUID();
    const timeout = timeoutMs ?? this.requestTimeoutMs;

    const request: RequestFrame = {
      type: "req",
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | null = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new GatewayClientError(
            "TIMEOUT",
            `request timed out after ${timeout}ms`
          )
        );
      }, timeout);

      this.pending.set(id, {
        resolve: (value: unknown) => resolve(value as T),
        reject,
        timeout: timeoutHandle,
      });

      try {
        this.ws!.send(JSON.stringify(request));
      } catch (err) {
        this.pending.delete(id);
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        reject(
          err instanceof Error
            ? err
            : new Error(String(err))
        );
      }
    });
  }

  /**
   * Check if the client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  private handleOpen(): void {
    // Connection opened - wait for connect challenge from the server
    // OpenClaw protocol: server sends connect.challenge first
    this.socketOpened = true;
    // If we have a nonce from challenge that came before open, send connect now
    if (this.connectNonce && !this.connectSent) {
      this.sendConnect();
    }
  }

  private handleMessage(data: Buffer | string): void {
    try {
      const raw = typeof data === "string" ? data : data.toString("utf-8");
      const parsed = JSON.parse(raw) as unknown;

      if (typeof parsed !== "object" || !parsed) {
        return;
      }

      const obj = parsed as Record<string, unknown>;

      // Check if it's an event frame (has 'event' field)
      if (typeof obj.event === "string") {
        this.handleEventFrame(obj as unknown as EventFrame);
        return;
      }

      // Check if it's a response frame (has 'id' field)
      if (typeof obj.id === "string" && typeof obj.ok === "boolean") {
        this.handleResponseFrame(obj as unknown as ResponseFrame);
        return;
      }

      // Unknown frame type
    } catch (err) {
      // Ignore parse errors - might be binary data or protocol change
    }
  }

  private handleResponseFrame(parsed: ResponseFrame): void {
    const pending = this.pending.get(parsed.id);
    if (!pending) {
      return;
    }

    this.pending.delete(parsed.id);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }

    if (parsed.ok) {
      // Check if this is a successful connect response
      const payload = typeof parsed.payload === "object" && parsed.payload
        ? (parsed.payload as Record<string, unknown>)
        : {};
      if (payload.type === "hello-ok") {
        this.connected = true;
        this.emit("connected");
      }
      pending.resolve(parsed.payload);
    } else {
      pending.reject(
        new GatewayClientError(
          parsed.error?.code ?? "UNKNOWN_ERROR",
          parsed.error?.message ?? "unknown error",
          parsed.error?.details
        )
      );
    }
  }

  private handleEventFrame(parsed: EventFrame): void {
    // Handle special events
    if (parsed.event === "connect.ok") {
      this.connected = true;
      this.emit("connected");
    }

    if (parsed.event === "connect.challenge" && !this.connectSent) {
      const payload = typeof parsed.payload === "object" && parsed.payload
        ? (parsed.payload as Record<string, unknown>)
        : {};
      const nonce = payload.nonce;
      if (typeof nonce === "string" && nonce.trim()) {
        this.connectNonce = nonce.trim();
        this.sendConnect();
      }
      return;
    }

    // Emit all events
    this.opts.onEvent?.(parsed);
  }

  private sendConnect(): void {
    if (this.connectSent || !this.connectNonce) {
      return;
    }

    this.connectSent = true;

    // Build auth object - only include fields with values
    const auth: Record<string, unknown> = {};
    if (this.opts.token) {
      auth.token = this.opts.token;
    }
    if (this.opts.password) {
      auth.password = this.opts.password;
    }

    // Build device object if device identity is available
    // This is crucial for proper node registration on the gateway
    let device: Record<string, unknown> | undefined;
    if (this.opts.deviceIdentity) {
      try {
        // Use consistent timestamp for both payload and device object
        const signedAtMs = Date.now();
        
        // Determine appropriate scopes based on role (must match connectParams.scopes)
        const deviceScopes = this.role === "operator" 
          ? ["operator.admin"]
          : [];
        
        const payload = buildDeviceAuthPayloadV3({
          deviceId: this.opts.deviceIdentity.deviceId,
          clientId: "gateway-client",
          clientMode: this.role === "node" ? "node" : "backend",  // Match role in signature
          role: this.role,  // Use configured role in device signature
          scopes: deviceScopes,
          signedAtMs,
          token: this.opts.token ?? null,
          nonce: this.connectNonce,
          platform: process.platform,
          deviceFamily: undefined,
        });
        
        const signature = signDevicePayload(
          this.opts.deviceIdentity.privateKeyPem,
          payload
        );
        
        device = {
          id: this.opts.deviceIdentity.deviceId,
          publicKey: publicKeyRawBase64UrlFromPem(this.opts.deviceIdentity.publicKeyPem),
          signature,
          signedAt: signedAtMs,
          nonce: this.connectNonce,
        };
      } catch (err) {
        // Log error but continue - device identity is optional
        console.warn(
          "Failed to build device identity for connect request:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // Determine appropriate scopes based on role
    const scopes = this.role === "operator" 
      ? ["operator.admin"]  // Full admin scope for operator connections
      : [];  // No scopes for node connections

    const connectParams: Record<string, unknown> = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: this.clientId, // Use provided clientId or default "gateway-client"
        displayName: "OpenClaw Connector",
        version: "0.1.0",
        platform: process.platform,
        mode: this.role === "node" ? "node" : "backend",  // Match role: node connects as node mode
      },
      role: this.role,  // Use configured role (operator or node)
      scopes,
      caps: this.caps,
      commands: this.commands,
      permissions: this.permissions,
      pathEnv: this.pathEnv,
    };

    // Only include auth if there are credentials
    if (Object.keys(auth).length > 0) {
      connectParams.auth = auth;
    }

    // Include device if available
    if (device) {
      connectParams.device = device;
    }

    const id = randomUUID();
    const request: RequestFrame = {
      type: "req",
      id,
      method: "connect",
      params: connectParams,
    };

    try {
      // Add pending entry for connect response
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        this.opts.onConnectError?.(new Error("connect request timeout"));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: () => {
          // Connect response resolved
        },
        reject: (err: unknown) => {
          this.opts.onConnectError?.(err instanceof Error ? err : new Error(String(err)));
        },
        timeout,
      });

      this.ws?.send(JSON.stringify(request));
    } catch (err) {
      this.pending.delete(id);
      this.opts.onConnectError?.(
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }

  private handleClose(code: number, reason: Buffer | string): void {
    this.connected = false;
    this.socketOpened = false;
    const reasonText = typeof reason === "string" ? reason : reason.toString("utf-8");
    this.flushPendingErrors(
      new Error(`gateway closed (${code}): ${reasonText}`)
    );
    this.opts.onClose?.(code, reasonText);
  }

  private handleError(err: Error): void {
    this.opts.onConnectError?.(err);
  }

  private flushPendingErrors(err: Error): void {
    for (const [, pending] of this.pending.entries()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(err);
    }
    this.pending.clear();
  }
}
