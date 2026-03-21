import type { OpenClawPluginAPI } from './types.js';
import { RecursiveClawEngine } from './engine/context-engine.js';

/**
 * OpenClaw plugin entry point.
 * Called by OpenClaw when the plugin is loaded.
 */
export default function register(api: OpenClawPluginAPI): void {
  api.registerContextEngine('recursive-claw', (config) => {
    return new RecursiveClawEngine(api, config);
  });
}
