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
  // Per-remote command policy overrides (PLAN Section 4.1)
  private remoteCommandPolicies = new Map<string, CommandPolicy>();
  private breakerConfig: BridgeOptions["breakerConfig"];
  private logger: ILogger;

  constructor(opts: BridgeOptions) {
    this.commandPolicy = opts.commandPolicy;
    this.breakerConfig = opts.breakerConfig;
    this.logger = opts.logger;
  }

  registerRemote(remoteId: string, client: IRemoteClient, remotePolicy?: CommandPolicy): void {
    this.remoteClients.set(remoteId, client);

    // Store per-remote policy override if provided (PLAN Section 4.1)
    if (remotePolicy) {
      this.remoteCommandPolicies.set(remoteId, remotePolicy);
    }

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
   *
   * Flow follows PLAN Section 5:
   * 1) Map nodeRegistration to remoteId
   * 2) Check command policy (allow_all / allow_list)
   * 3) Check remote circuit breaker state (OPEN = fast fail)
   * 4) Call corresponding RemoteClient handler
   * 5) Record success/failure and update breaker state
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

    // Step 3: Check command permission (PLAN Section 5)
    const isAllowed = this.isCommandAllowed(command, remoteId);
    if (!isAllowed) {
      return {
        ok: false,
        error: { code: "FORBIDDEN", message: `command ${command} not allowed` },
      };
    }

    // Step 4: Check handler exists (before breaker to avoid occupying halfOpenInFlight slot)
    const handler = this.commandHandlers.get(command);
    if (!handler) {
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: `command ${command} not supported` },
      };
    }

    // Step 5: Check breaker state (MUST be after handler check to prevent halfOpenInFlight leak)
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
   * Supports per-remote override (PLAN Section 4.1)
   */
  private isCommandAllowed(command: string, remoteId: string): boolean {
    // Use per-remote policy if available, otherwise fall back to global
    const effectivePolicy = this.remoteCommandPolicies.get(remoteId) ?? this.commandPolicy;

    if (effectivePolicy.mode === "allow_all") {
      return true;
    }

    if (effectivePolicy.mode === "allow_list") {
      return effectivePolicy.allowList?.includes(command) ?? false;
    }

    return false;
  }

  /**
   * Execute handler with timeout (timer is properly cleaned up on completion)
   */
  private executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        timer = null; // Prevent double-clear
        reject(new Error("TIMEOUT"));
      }, timeoutMs);
    });

    const result = Promise.race([fn(), timeoutPromise]);

    // Clean up timer when the race resolves (whether from success or timeout)
    // Note: We don't await here — we just schedule cleanup after the promise settles
    result.finally(() => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    });

    return result;
  }
}
