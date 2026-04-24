/**
 * Circuit breaker implementation for per-remote resilience
 */

import type { CircuitBreakerState, ICircuitBreaker, ILogger } from "../types.js";
import { shouldTriggerBreaker } from "./error-classifier.js";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  openMs: number;
  halfOpenMaxInFlight: number;
  logger: ILogger;
  remoteId: string;
}

export class CircuitBreaker implements ICircuitBreaker {
  private state: CircuitBreakerState = "CLOSED";
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private halfOpenInFlight = 0;
  private failureThreshold: number;
  private openMs: number;
  private halfOpenMaxInFlight: number;
  private logger: ILogger;
  private remoteId: string;

  constructor(opts: CircuitBreakerOptions) {
    this.failureThreshold = opts.failureThreshold;
    this.openMs = opts.openMs;
    this.halfOpenMaxInFlight = opts.halfOpenMaxInFlight;
    this.logger = opts.logger;
    this.remoteId = opts.remoteId;
  }

  canExecute(): boolean {
    if (this.state === "CLOSED") {
      return true;
    }

    if (this.state === "OPEN") {
      if (!this.lastFailureTime) return false;
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.openMs) {
        this.transitionTo("HALF_OPEN");
        return this.canExecute(); // retry after transition
      }
      return false;
    }

    if (this.state === "HALF_OPEN") {
      return this.halfOpenInFlight < this.halfOpenMaxInFlight;
    }

    return false;
  }

  recordSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      if (this.halfOpenInFlight === 0) {
        this.transitionTo("CLOSED");
        this.failureCount = 0;
      }
    } else if (this.state === "CLOSED") {
      // Reset failure count on success
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  recordFailure(error: unknown): void {
    // Only count breaker-triggering errors (availability/network issues)
    if (!shouldTriggerBreaker(error)) {
      return;
    }

    this.lastFailureTime = Date.now();

    if (this.state === "HALF_OPEN") {
      this.transitionTo("OPEN");
      this.failureCount = this.failureThreshold;
      return;
    }

    if (this.state === "CLOSED") {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.transitionTo("OPEN");
      }
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  private transitionTo(newState: CircuitBreakerState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;

    if (newState === "OPEN") {
      this.logger.logEvent("breaker.open", {
        remoteId: this.remoteId,
        fromState: oldState,
        failureCount: this.failureCount,
        willRetryMs: this.openMs,
      });
    } else if (newState === "HALF_OPEN") {
      this.logger.logEvent("breaker.half_open", {
        remoteId: this.remoteId,
        fromState: oldState,
      });
    } else if (newState === "CLOSED") {
      this.logger.logEvent("breaker.close", {
        remoteId: this.remoteId,
        fromState: oldState,
      });
    }
  }
}
