import type { GamePlugin } from './types';

// Module-level registry. Plugins call `register(plugin)` at module load
// (typically via a side-effect import of the plugin's index.ts) so any
// consumer that imports the plugin also imports its registration.
const registry: Record<string, GamePlugin<unknown>> = {};

export function register<T>(plugin: GamePlugin<T>): void {
  if (registry[plugin.type]) {
    throw new Error(`plugin already registered: ${plugin.type}`);
  }
  registry[plugin.type] = plugin as GamePlugin<unknown>;
}

export function getPlugin(type: string): GamePlugin<unknown> | undefined {
  return registry[type];
}

export function listPlugins(): string[] {
  return Object.keys(registry);
}
