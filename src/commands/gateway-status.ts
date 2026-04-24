/**
 * Command: gateway.status
 * Get health status of the remote gateway
 */

import type { Command, IRemoteClient } from "../types.js";

export const gatewayStatusCommand: Command = {
  name: "gateway.status",
  description: "Get health status of the remote gateway",
  handler: async (params: unknown, client: IRemoteClient) => {
    const result = await client.request("health", params);
    if (!result.ok) {
      throw new Error(result.error?.message ?? "Failed to get gateway status");
    }
    return result.data;
  },
};
