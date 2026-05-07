/**
 * Command Catalog - Extensible command registry and documentation
 *
 * Provides a catalog of available commands with:
 * - Built-in commands (always available)
 * - Custom commands (user-defined)
 * - Command metadata and descriptions
 * - Easy registration of new commands
 */

export interface CommandMetadata {
  name: string;
  description?: string;
  enabled: boolean;
  category?: string;
  version?: string;
}

/**
 * Built-in command categories and descriptions
 */
export const BUILTIN_COMMANDS: Record<string, CommandMetadata> = {
  // Session commands
  "sessions.list": {
    name: "sessions.list",
    description: "List all sessions on the remote gateway",
    enabled: true,
    category: "session",
  },
  "sessions.send": {
    name: "sessions.send",
    description: "Send a message to a session on the remote gateway",
    enabled: true,
    category: "session",
  },
  "sessions.get_messages": {
    name: "sessions.get_messages",
    description: "Get recent messages from a session (for polling agent responses)",
    enabled: true,
    category: "session",
  },

  // Node commands
  "nodes.list": {
    name: "nodes.list",
    description: "List all nodes managed by the remote gateway",
    enabled: true,
    category: "node",
  },
  "nodes.invoke": {
    name: "nodes.invoke",
    description: "Invoke a command on a node managed by the remote gateway",
    enabled: true,
    category: "node",
  },

  // Gateway commands
  "gateway.status": {
    name: "gateway.status",
    description: "Get health status of the remote gateway",
    enabled: true,
    category: "gateway",
  },

  // Additional session commands (optional)
  "sessions.close": {
    name: "sessions.close",
    description: "Close a session on the remote gateway",
    enabled: false, // Disabled by default, can be enabled by user
    category: "session",
  },
  "sessions.get": {
    name: "sessions.get",
    description: "Get details of a specific session",
    enabled: false,
    category: "session",
  },

  // Additional node commands (optional)
  "nodes.approve": {
    name: "nodes.approve",
    description: "Approve a node registration request",
    enabled: false,
    category: "node",
  },

  // Additional gateway commands (optional)
  "gateway.config": {
    name: "gateway.config",
    description: "Get gateway configuration details",
    enabled: false,
    category: "gateway",
  },
  "gateway.metrics": {
    name: "gateway.metrics",
    description: "Get gateway metrics and statistics",
    enabled: false,
    category: "gateway",
  },
};

/**
 * Get list of enabled commands
 *
 * @returns Array of enabled command names
 */
export function getEnabledCommands(): string[] {
  return Object.entries(BUILTIN_COMMANDS)
    .filter(([, cmd]) => cmd.enabled)
    .map(([name]) => name);
}

/**
 * Get list of all commands (including disabled)
 *
 * @returns Array of all command names
 */
export function getAllCommands(): string[] {
  return Object.keys(BUILTIN_COMMANDS);
}

/**
 * Get command metadata
 *
 * @param commandName - Name of the command
 * @returns Command metadata or undefined if not found
 */
export function getCommandMetadata(commandName: string): CommandMetadata | undefined {
  return BUILTIN_COMMANDS[commandName];
}

/**
 * Get commands by category
 *
 * @param category - Category name
 * @param enabledOnly - If true, only return enabled commands
 * @returns Array of command names in the category
 */
export function getCommandsByCategory(
  category: string,
  enabledOnly = false
): string[] {
  return Object.entries(BUILTIN_COMMANDS)
    .filter(([, cmd]) => cmd.category === category && (!enabledOnly || cmd.enabled))
    .map(([name]) => name);
}

/**
 * Get all command categories
 *
 * @param enabledCommandsOnly - If true, only include categories with enabled commands
 * @returns Array of unique category names
 */
export function getCommandCategories(enabledCommandsOnly = false): string[] {
  const categories = new Set<string>();

  for (const [, cmd] of Object.entries(BUILTIN_COMMANDS)) {
    if (cmd.category && (!enabledCommandsOnly || cmd.enabled)) {
      categories.add(cmd.category);
    }
  }

  return Array.from(categories).sort();
}

/**
 * Enable a command
 *
 * @param commandName - Name of the command to enable
 * @returns true if command was enabled, false if already enabled or not found
 */
export function enableCommand(commandName: string): boolean {
  const cmd = BUILTIN_COMMANDS[commandName];
  if (!cmd) {
    return false;
  }

  if (cmd.enabled) {
    return false; // Already enabled
  }

  cmd.enabled = true;
  return true;
}

/**
 * Disable a command
 *
 * @param commandName - Name of the command to disable
 * @returns true if command was disabled, false if already disabled or not found
 */
export function disableCommand(commandName: string): boolean {
  const cmd = BUILTIN_COMMANDS[commandName];
  if (!cmd) {
    return false;
  }

  if (!cmd.enabled) {
    return false; // Already disabled
  }

  cmd.enabled = false;
  return true;
}

/**
 * Get command statistics
 *
 * @returns Object with command statistics
 */
export function getCommandStats(): {
  total: number;
  enabled: number;
  disabled: number;
  categories: number;
} {
  const all = getAllCommands();
  const enabled = getEnabledCommands();
  const categories = getCommandCategories();

  return {
    total: all.length,
    enabled: enabled.length,
    disabled: all.length - enabled.length,
    categories: categories.length,
  };
}

/**
 * Get a formatted command list for display
 *
 * @param enabledOnly - If true, only show enabled commands
 * @returns Formatted string with command list
 */
export function formatCommandList(enabledOnly = false): string {
  const categories = getCommandCategories(enabledOnly);
  const lines: string[] = [];

  for (const category of categories) {
    const commands = getCommandsByCategory(category, enabledOnly);
    lines.push(`\n${category.toUpperCase()}:`);

    for (const cmd of commands) {
      const meta = getCommandMetadata(cmd);
      const status = meta?.enabled ? "✓" : "✗";
      const desc = meta?.description ? ` - ${meta.description}` : "";
      lines.push(`  [${status}] ${cmd}${desc}`);
    }
  }

  return lines.join("\n");
}
