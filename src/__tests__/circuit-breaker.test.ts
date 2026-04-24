/**
 * Circuit Breaker Unit Tests (Example)
 * Note: This is a test structure example. To run, install Jest:
 * npm install --save-dev @types/jest
 */

import { CircuitBreaker } from "../resilience/circuit-breaker.js";
import { createLogger } from "../logger.js";

// For test framework compatibility (Jest, Mocha, etc.)
const describe = typeof globalThis !== "undefined" && (globalThis as any).describe ? (globalThis as any).describe : (name: string, fn: () => void) => fn();
const it = typeof globalThis !== "undefined" && (globalThis as any).it ? (globalThis as any).it : (name: string, fn: () => void) => fn();
const expect = typeof globalThis !== "undefined" && (globalThis as any).expect ? (globalThis as any).expect : (val: unknown) => ({ toBe: (expected: unknown) => val === expected });

describe("CircuitBreaker", () => {
  const logger = createLogger("test");
  const createBreaker = () =>
    new CircuitBreaker({
      failureThreshold: 3,
      openMs: 100,
      halfOpenMaxInFlight: 1,
      logger,
      remoteId: "test-remote",
    });

  it("should start in CLOSED state", () => {
    const breaker = createBreaker();
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.canExecute()).toBe(true);
  });

  it("should transition to OPEN after failure threshold", () => {
    const breaker = createBreaker();

    // Record 3 availability errors
    breaker.recordFailure(new Error("NOT_CONNECTED"));
    breaker.recordFailure(new Error("UNAVAILABLE"));
    breaker.recordFailure(new Error("TIMEOUT"));

    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.canExecute()).toBe(false);
  });

  it("should not count business errors", () => {
    const breaker = createBreaker();

    // Record business errors (should not trigger OPEN)
    breaker.recordFailure(new Error("INVALID_PARAMS"));
    breaker.recordFailure(new Error("NOT_FOUND"));
    breaker.recordFailure(new Error("FORBIDDEN"));

    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.canExecute()).toBe(true);
  });

  it("should transition to HALF_OPEN after openMs elapsed", async () => {
    const breaker = createBreaker();

    // Trigger OPEN
    breaker.recordFailure(new Error("UNAVAILABLE"));
    breaker.recordFailure(new Error("UNAVAILABLE"));
    breaker.recordFailure(new Error("UNAVAILABLE"));

    expect(breaker.getState()).toBe("OPEN");

    // Wait for openMs
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should allow execution and transition to HALF_OPEN
    expect(breaker.canExecute()).toBe(true);
    expect(breaker.getState()).toBe("HALF_OPEN");
  });

  it("should return to CLOSED on success in HALF_OPEN", async () => {
    const breaker = createBreaker();

    // Trigger OPEN
    breaker.recordFailure(new Error("UNAVAILABLE"));
    breaker.recordFailure(new Error("UNAVAILABLE"));
    breaker.recordFailure(new Error("UNAVAILABLE"));

    // Wait for HALF_OPEN
    await new Promise((resolve) => setTimeout(resolve, 150));
    breaker.canExecute(); // Transition to HALF_OPEN

    // Record success
    breaker.recordSuccess();

    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.canExecute()).toBe(true);
  });

  it("should return to OPEN on failure in HALF_OPEN", async () => {
    const breaker = createBreaker();

    // Trigger OPEN
    breaker.recordFailure(new Error("UNAVAILABLE"));
    breaker.recordFailure(new Error("UNAVAILABLE"));
    breaker.recordFailure(new Error("UNAVAILABLE"));

    // Wait for HALF_OPEN
    await new Promise((resolve) => setTimeout(resolve, 150));
    breaker.canExecute(); // Transition to HALF_OPEN

    // Record failure
    breaker.recordFailure(new Error("UNAVAILABLE"));

    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.canExecute()).toBe(false);
  });
});
