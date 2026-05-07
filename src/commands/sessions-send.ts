/**
 * Command: sessions.send
 * Send a message to a session on the remote gateway
 * 
 * Supported parameter formats:
 * - {key: "session-id", message: "text"}  (OpenClaw native)
 * - {sessionId: "session-id", message: "text"}  (user-friendly, auto-converted)
 */

import type { Command, IRemoteClient } from "../types.js";

export const sessionsSendCommand: Command = {
  name: "sessions.send",
  description: "Send a message to a session on the remote gateway",
  handler: async (params: unknown, client: IRemoteClient) => {
    // Normalize parameters: support both 'key' and 'sessionId' field names
    let normalizedParams = params;
    if (typeof params === "object" && params !== null) {
      const p = params as Record<string, unknown>;
      // If user provided 'sessionId', convert it to 'key' for compatibility
      if ("sessionId" in p && !("key" in p)) {
        normalizedParams = {
          ...p,
          key: p.sessionId,
        };
        // Remove sessionId to avoid "unexpected property" error
        const { sessionId, ...rest } = normalizedParams as any;
        normalizedParams = rest;
      }
    }

    const result = await client.request("sessions.send", normalizedParams);
    if (!result.ok) {
      throw new Error(result.error?.message ?? "Failed to send message");
    }
    return result.data;
  },
};
