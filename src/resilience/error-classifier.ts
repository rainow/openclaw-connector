/**
 * Error Classifier - Categorize errors for circuit breaker and logging
 *
 * Provides error classification for:
 * - Availability errors (trigger circuit breaker)
 * - Business errors (don't trigger circuit breaker)
 * - Transient errors (safe to retry)
 * - Permanent errors (no retry)
 */

export enum ErrorCategory {
  AVAILABILITY = "AVAILABILITY", // Network/connectivity issues
  BUSINESS = "BUSINESS", // Application-level errors
  TRANSIENT = "TRANSIENT", // Temporary, safe to retry
  PERMANENT = "PERMANENT", // Won't recover, don't retry
  UNKNOWN = "UNKNOWN", // Uncategorized
}

export interface ErrorClassification {
  category: ErrorCategory;
  code?: string;
  message: string;
  retriable: boolean;
  breakerTriggering: boolean;
}

/**
 * Standard error codes for availability issues
 */
const AVAILABILITY_ERROR_CODES = new Set([
  "NOT_CONNECTED",
  "UNAVAILABLE",
  "TIMEOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EADDRINUSE",
  "EADDRNOTAVAIL",
  "EPIPE",
  "ENETRESET",
  "ECONNABORTED",
]);

/**
 * Standard error codes for transient issues
 */
const TRANSIENT_ERROR_CODES = new Set([
  "EAGAIN",
  "EWOULDBLOCK",
  "EINTR",
]);

/**
 * Standard error codes for business errors (don't trigger breaker)
 */
const BUSINESS_ERROR_CODES = new Set([
  "ENOENT", // Not found
  "EINVAL", // Invalid argument
  "EACCES", // Permission denied
  "EPERM", // Operation not permitted
  "EBADF", // Bad file descriptor
]);

/**
 * Extract error code from various error types
 */
function extractErrorCode(error: unknown): string | undefined {
  if (error instanceof Error) {
    // Check for Node.js system error
    const sysErr = error as unknown as { code?: string; message?: string };
    if (sysErr.code) return sysErr.code;

    // Check error message for common patterns
    const msg = error.message;
    if (msg.includes("timeout")) return "TIMEOUT";
    if (msg.includes("connect")) return "NOT_CONNECTED";
    if (msg.includes("network")) return "ENETUNREACH";
    if (msg.includes("refused")) return "ECONNREFUSED";
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as unknown as { code?: unknown }).code);
  }

  return undefined;
}

/**
 * Classify an error for circuit breaker and logging purposes
 *
 * @param error - The error to classify
 * @returns Error classification with category and metadata
 */
export function classifyError(error: unknown): ErrorClassification {
  const code = extractErrorCode(error);
  const message = error instanceof Error ? error.message : String(error);

  // Check availability errors (trigger circuit breaker)
  if (code && AVAILABILITY_ERROR_CODES.has(code)) {
    return {
      category: ErrorCategory.AVAILABILITY,
      code,
      message,
      retriable: true,
      breakerTriggering: true,
    };
  }

  // Check transient errors (safe to retry but don't trigger breaker permanently)
  if (code && TRANSIENT_ERROR_CODES.has(code)) {
    return {
      category: ErrorCategory.TRANSIENT,
      code,
      message,
      retriable: true,
      breakerTriggering: false,
    };
  }

  // Check business errors (application errors, don't trigger breaker)
  if (code && BUSINESS_ERROR_CODES.has(code)) {
    return {
      category: ErrorCategory.BUSINESS,
      code,
      message,
      retriable: false,
      breakerTriggering: false,
    };
  }

  // Try to detect from message patterns
  if (message.toLowerCase().includes("not found")) {
    return {
      category: ErrorCategory.BUSINESS,
      code: "ENOENT",
      message,
      retriable: false,
      breakerTriggering: false,
    };
  }

  if (message.toLowerCase().includes("permission")) {
    return {
      category: ErrorCategory.BUSINESS,
      code: "EACCES",
      message,
      retriable: false,
      breakerTriggering: false,
    };
  }

  if (message.toLowerCase().includes("invalid")) {
    return {
      category: ErrorCategory.BUSINESS,
      code: "EINVAL",
      message,
      retriable: false,
      breakerTriggering: false,
    };
  }

  // Default to business error (safer - don't break circuit for unknown errors)
  return {
    category: ErrorCategory.UNKNOWN,
    code,
    message,
    retriable: false,
    breakerTriggering: false,
  };
}

/**
 * Check if an error should trigger circuit breaker
 *
 * @param error - The error to check
 * @returns true if error should trigger circuit breaker
 */
export function shouldTriggerBreaker(error: unknown): boolean {
  return classifyError(error).breakerTriggering;
}

/**
 * Check if an error is retriable
 *
 * @param error - The error to check
 * @returns true if error should be retried
 */
export function isRetriable(error: unknown): boolean {
  return classifyError(error).retriable;
}

/**
 * Get error severity level (for logging)
 *
 * @param error - The error to classify
 * @returns Severity level: "critical", "warning", or "info"
 */
export function getErrorSeverity(error: unknown): "critical" | "warning" | "info" {
  const classification = classifyError(error);

  switch (classification.category) {
    case ErrorCategory.AVAILABILITY:
      return "critical"; // Network issues are critical
    case ErrorCategory.TRANSIENT:
      return "warning"; // Transient issues are warnings
    case ErrorCategory.BUSINESS:
      return "info"; // Business errors are just info
    case ErrorCategory.PERMANENT:
      return "warning"; // Permanent errors warrant attention
    case ErrorCategory.UNKNOWN:
      return "warning"; // Unknown errors are suspicious
  }
}

/**
 * Get a user-friendly error message
 *
 * @param error - The error to describe
 * @returns User-friendly error message
 */
export function getUserFriendlyMessage(error: unknown): string {
  const classification = classifyError(error);

  switch (classification.category) {
    case ErrorCategory.AVAILABILITY:
      return `Connection failed: ${classification.message}. Retrying...`;
    case ErrorCategory.TRANSIENT:
      return `Temporary error: ${classification.message}. Retrying...`;
    case ErrorCategory.BUSINESS:
      return `Operation failed: ${classification.message}`;
    case ErrorCategory.PERMANENT:
      return `Permanent error: ${classification.message}. Not retrying.`;
    case ErrorCategory.UNKNOWN:
      return `Unexpected error: ${classification.message}`;
  }
}

/**
 * Get error statistics
 *
 * Useful for monitoring error patterns over time
 */
export class ErrorStatistics {
  private counts: Map<ErrorCategory, number> = new Map();
  private codes: Map<string, number> = new Map();

  recordError(error: unknown): void {
    const classification = classifyError(error);
    const count = (this.counts.get(classification.category) || 0) + 1;
    this.counts.set(classification.category, count);

    if (classification.code) {
      const codeCount = (this.codes.get(classification.code) || 0) + 1;
      this.codes.set(classification.code, codeCount);
    }
  }

  getStats(): Record<string, unknown> {
    const stats: Record<string, unknown> = {
      total: Array.from(this.counts.values()).reduce((a, b) => a + b, 0),
      byCategory: Object.fromEntries(this.counts),
      topCodes: Array.from(this.codes.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    };

    return stats;
  }

  reset(): void {
    this.counts.clear();
    this.codes.clear();
  }
}
