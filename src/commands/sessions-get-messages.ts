/**
 * Command: sessions.get_messages
 * Get recent messages from a session on the remote gateway
 * 
 * This allows polling for agent responses after sending a message.
 * Falls back to sessions.get if sessions.get_messages is not available.
 * 
 * Supported parameter formats:
 * - {key: "session-id", limit: 10}  (OpenClaw native)
 * - {sessionId: "session-id", limit: 10}  (user-friendly, auto-converted)
 */

import type { Command, IRemoteClient } from "../types.js";

export const sessionsGetMessagesCommand: Command = {
  name: "sessions.get_messages",
  description: "Get recent messages from a session on the remote gateway",
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

    // Try multiple fallback methods since the local gateway may support different APIs
    let result = await client.request("sessions.get_messages", normalizedParams);
    if (!result.ok && result.error?.message?.includes("unknown method")) {
      // Fallback 1: Try sessions.get (get session details)
      result = await client.request("sessions.get", normalizedParams);
    }
    if (!result.ok && result.error?.message?.includes("unknown method")) {
      // Fallback 2: Try sessions.history (get session message history)
      result = await client.request("sessions.history", normalizedParams);
    }
    if (!result.ok && result.error?.message?.includes("unknown method")) {
      // Fallback 3: Try sessions.messages (alternative name)
      result = await client.request("sessions.messages", normalizedParams);
    }
    
    if (!result.ok) {
      throw new Error(
        result.error?.message ?? 
        "Failed to get messages. The local gateway may not support sessions.get_messages, sessions.get, sessions.history, or sessions.messages."
      );
    }
    return result.data;
  },
};
