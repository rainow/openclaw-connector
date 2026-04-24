/**
 * Command: sessions.list
 * Lists all sessions on the remote gateway
 */

import type { Command, IRemoteClient } from "../types.js";

export const sessionsListCommand: Command = {
  name: "sessions.list",
  description: "List all sessions on the remote gateway",
  handler: async (params: unknown, client: IRemoteClient) => {
    const result = await client.request("sessions.list", params);
    if (!result.ok) {
      throw new Error(result.error?.message ?? "Failed to list sessions");
    }
    return result.data;
  },
};
