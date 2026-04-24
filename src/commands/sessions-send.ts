/**
 * Command: sessions.send
 * Send a message to a session on the remote gateway
 */

import type { Command, IRemoteClient } from "../types.js";

export const sessionsSendCommand: Command = {
  name: "sessions.send",
  description: "Send a message to a session on the remote gateway",
  handler: async (params: unknown, client: IRemoteClient) => {
    const result = await client.request("sessions.send", params);
    if (!result.ok) {
      throw new Error(result.error?.message ?? "Failed to send message");
    }
    return result.data;
  },
};
