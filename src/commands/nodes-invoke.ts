/**
 * Command: nodes.invoke
 * Invoke a command on a node managed by the remote gateway
 */

import type { Command, IRemoteClient } from "../types.js";

export const nodesInvokeCommand: Command = {
  name: "nodes.invoke",
  description: "Invoke a command on a node managed by the remote gateway",
  handler: async (params: unknown, client: IRemoteClient) => {
    const result = await client.request("nodes.invoke", params);
    if (!result.ok) {
      throw new Error(result.error?.message ?? "Failed to invoke on remote node");
    }
    return result.data;
  },
};
