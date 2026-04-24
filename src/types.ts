/**
 * Core type definitions for OpenClaw Connector
 */

export type CommandPolicy = {
  mode: "allow_all" | "allow_list";
  allowList?: string[];
};

export type CircuitBreakerConfig = {
  enabled: boolean;
  failureThreshold: number;
  openMs: number;
  halfOpenMaxInFlight: number;
};

export type RemoteGatewayConfig = {
  id: string;
  url: string;
  token?: string;
  password?: string;
  enabled?: boolean;
  timeoutMs?: number;
  commandPolicy?: CommandPolicy;
};

export type GatewayBConfig = {
  url: string;
  token?: string;
  password?: string;
};

export type ConnectorConfig = {
  gatewayB: GatewayBConfig;
  commandPolicy?: CommandPolicy;
  breaker?: CircuitBreakerConfig;
  remotes: RemoteGatewayConfig[];
};

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface IRemoteClient {
  isReady(): boolean;
  request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs?: number
  ): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }>;
  onConnectError(callback: (err: Error) => void): void;
  onClose(callback: (code: number, reason: string) => void): void;
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface ICircuitBreaker {
  canExecute(): boolean;
  recordSuccess(): void;
  recordFailure(error: unknown): void;
  getState(): CircuitBreakerState;
}

export interface ILogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  logEvent(event: string, fields: Record<string, unknown>): void;
}

export type InvokeRequest = {
  id: string;
  nodeId: string;
  command: string;
  params?: unknown;
  paramsJSON?: string | null;
  timeoutMs?: number;
  idempotencyKey?: string | null;
};

export type InvokeResult = {
  ok: boolean;
  payload?: unknown;
  payloadJSON?: string | null;
  error?: { code?: string; message?: string } | null;
};

export type CommandHandler = (
  params: unknown,
  remoteClient: IRemoteClient
) => Promise<unknown>;

export type Command = {
  name: string;
  description?: string;
  handler: CommandHandler;
};
