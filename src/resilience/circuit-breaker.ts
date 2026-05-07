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
        this.halfOpenInFlight = 0; // Reset in-flight counter when entering HALF_OPEN
        return this.canExecute(); // retry after transition
      }
      return false;
    }

    if (this.state === "HALF_OPEN") {
      // FIX: Increment in-flight counter to properly limit probe requests
      if (this.halfOpenInFlight < this.halfOpenMaxInFlight) {
        this.halfOpenInFlight++;
        return true;
      }
      return false;
    }

    return false;
  }

  recordSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      if (this.halfOpenInFlight === 0) {
        this.transitionTo("CLOSED");
        this.failureCount = 0; // Full reset on successful probe
      }
    } else if (this.state === "CLOSED") {
      // PLAN requires consecutive failures: any success resets the counter
      this.failureCount = 0;
    }
  }

  recordFailure(error: unknown): void {
    // Only availability/network issues should trigger breaker opening.
    // In HALF_OPEN, non-triggering errors still consume a probe slot and must be released.
    if (!shouldTriggerBreaker(error)) {
      if (this.state === "HALF_OPEN") {
        this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
        // Treat non-availability errors as a successful probe from breaker perspective.
        if (this.halfOpenInFlight === 0) {
          this.transitionTo("CLOSED");
          this.failureCount = 0;
        }
      }
      return;
    }

    this.lastFailureTime = Date.now();

    if (this.state === "HALF_OPEN") {
      // Availability error during probe: reopen breaker and reset probe slots.
      this.halfOpenInFlight = 0;
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
