/**
 * Bridge: Core routing and invoke handling
 */

import type {
  CommandPolicy,
  ICircuitBreaker,
  ILogger,
  IRemoteClient,
  InvokeRequest,
  InvokeResult,
  Command,
} from "./types.js";
import { CircuitBreaker } from "./resilience/circuit-breaker.js";

export interface BridgeOptions {
  commandPolicy: CommandPolicy;
  breakerConfig: {
    enabled: boolean;
    failureThreshold: number;
    openMs: number;
    halfOpenMaxInFlight: number;
  };
  logger: ILogger;
}

export class Bridge {
  private remoteClients = new Map<string, IRemoteClient>();
  private nodeToRemote = new Map<string, string>();
  private breakers = new Map<string, ICircuitBreaker>();
  private commandHandlers = new Map<string, (params: unknown, client: IRemoteClient) => Promise<unknown>>();
  private commandPolicy: CommandPolicy;
  private breakerConfig: BridgeOptions["breakerConfig"];
  private logger: ILogger;

  constructor(opts: BridgeOptions) {
    this.commandPolicy = opts.commandPolicy;
    this.breakerConfig = opts.breakerConfig;
    this.logger = opts.logger;
  }

  registerRemote(remoteId: string, client: IRemoteClient): void {
    this.remoteClients.set(remoteId, client);

    if (this.breakerConfig.enabled) {
      const breaker = new CircuitBreaker({
        remoteId,
        failureThreshold: this.breakerConfig.failureThreshold,
        openMs: this.breakerConfig.openMs,
        halfOpenMaxInFlight: this.breakerConfig.halfOpenMaxInFlight,
        logger: this.logger,
      });
      this.breakers.set(remoteId, breaker);
    }
  }

  registerNode(nodeId: string, remoteId: string): void {
    this.nodeToRemote.set(nodeId, remoteId);
  }

  registerCommand(
    command: Command,
    handler: (params: unknown, client: IRemoteClient) => Promise<unknown>
  ): void {
    this.commandHandlers.set(command.name, handler);
  }

  /**
   * Main invoke handler: called when Gateway B sends node.invoke.request
   */
  async handleInvoke(nodeId: string, payload: InvokeRequest): Promise<InvokeResult> {
    const invokeId = payload.id;
    const command = payload.command;
    const timeoutMs = payload.timeoutMs ?? 30000;

    this.logger.logEvent("invoke.receive", {
      invokeId,
      nodeId,
      command,
    });

    // Step 1: Map node to remote
    const remoteId = this.nodeToRemote.get(nodeId);
    if (!remoteId) {
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: `node ${nodeId} not registered` },
      };
    }

    // Step 2: Get remote client
    const remoteClient = this.remoteClients.get(remoteId);
    if (!remoteClient || !remoteClient.isReady()) {
      return {
        ok: false,
        error: { code: "UNAVAILABLE", message: `remote gateway ${remoteId} not connected` },
      };
    }

    // Step 3: Check breaker state
    const breaker = this.breakers.get(remoteId);
    if (breaker && !breaker.canExecute()) {
      const state = breaker.getState();
      this.logger.logEvent("invoke.breaker_open", {
        invokeId,
        nodeId,
        remoteId,
        command,
        state,
      });
      return {
        ok: false,
        error: { code: "CIRCUIT_OPEN", message: `circuit breaker ${state} for ${remoteId}` },
      };
    }

    // Step 4: Check command permission
    const isAllowed = this.isCommandAllowed(command, remoteId);
    if (!isAllowed) {
      return {
        ok: false,
        error: { code: "FORBIDDEN", message: `command ${command} not allowed` },
      };
    }

    // Step 5: Check handler exists
    const handler = this.commandHandlers.get(command);
    if (!handler) {
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: `command ${command} not supported` },
      };
    }

    // Step 6: Execute with timeout and breaker tracking
    const startTime = Date.now();
    try {
      const params = payload.paramsJSON ? JSON.parse(payload.paramsJSON) : undefined;

      const result = await this.executeWithTimeout(
        () => handler(params, remoteClient),
        timeoutMs
      );

      const durationMs = Date.now() - startTime;

      if (breaker) {
        breaker.recordSuccess();
      }

      this.logger.logEvent("invoke.success", {
        invokeId,
        nodeId,
        remoteId,
        command,
        durationMs,
      });

      return {
        ok: true,
        payload: result,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorCode = err instanceof Error ? err.message : "UNKNOWN_ERROR";

      if (breaker) {
        breaker.recordFailure(err);
      }

      this.logger.logEvent("invoke.fail", {
        invokeId,
        nodeId,
        remoteId,
        command,
        durationMs,
        errorCode,
      });

      return {
        ok: false,
        error: { code: "EXECUTION_ERROR", message: String(err) },
      };
    }
  }

  /**
   * Check if command is allowed based on policy
   */
  private isCommandAllowed(command: string, remoteId: string): boolean {
    // TODO: Support per-remote policy override
    // For now, use global policy

    if (this.commandPolicy.mode === "allow_all") {
      return true;
    }

    if (this.commandPolicy.mode === "allow_list") {
      return this.commandPolicy.allowList?.includes(command) ?? false;
    }

    return false;
  }

  /**
   * Execute handler with timeout
   */
  private executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error("TIMEOUT")),
          timeoutMs
        )
      ),
    ]);
  }
}
