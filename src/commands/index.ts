/**
 * Command registry
 */

import type { Command } from "../types.js";
import { sessionsListCommand } from "./sessions-list.js";
import { sessionsSendCommand } from "./sessions-send.js";
import { sessionsGetMessagesCommand } from "./sessions-get-messages.js";
import { nodesListCommand } from "./nodes-list.js";
import { nodesInvokeCommand } from "./nodes-invoke.js";
import { gatewayStatusCommand } from "./gateway-status.js";

export const COMMANDS: Command[] = [
  sessionsListCommand,
  sessionsSendCommand,
  sessionsGetMessagesCommand,
  nodesListCommand,
  nodesInvokeCommand,
  gatewayStatusCommand,
];

export function getCommandNames(): string[] {
  return COMMANDS.map((cmd) => cmd.name);
}

export function getCommand(name: string): Command | undefined {
  return COMMANDS.find((cmd) => cmd.name === name);
}
