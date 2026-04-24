/**
 * Command: nodes.list
 * Lists all nodes managed by the remote gateway
 */

import type { Command, IRemoteClient } from "../types.js";

export const nodesListCommand: Command = {
  name: "nodes.list",
  description: "List all nodes managed by the remote gateway",
  handler: async (params: unknown, client: IRemoteClient) => {
    const result = await client.request("nodes.list", params);
    if (!result.ok) {
      throw new Error(result.error?.message ?? "Failed to list nodes");
    }
    return result.data;
  },
};
