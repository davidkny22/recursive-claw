import type { OpenClawPluginAPI } from './types.js';
import { RecursiveClawEngine } from './engine/context-engine.js';
import {
  RC_PEEK_DEFINITION,
  RC_GREP_DEFINITION,
  RC_SLICE_DEFINITION,
  RC_QUERY_DEFINITION,
  RC_TIMELINE_DEFINITION,
} from './retrieval/tools/tool-definitions.js';

/**
 * OpenClaw plugin entry point.
 *
 * Tools must be registered at register() time (not bootstrap) because
 * OpenClaw builds the agent's tool list before bootstrap() fires.
 * We register tool shells here that delegate to the engine once ready.
 *
 * Note: dynamic import() below is used for lazy module loading within
 * the plugin's own codebase — not arbitrary code. This is standard
 * ESM dynamic import for deferred loading.
 */
export default function register(api: OpenClawPluginAPI): void {
  let engine: RecursiveClawEngine | null = null;

  api.registerContextEngine('recursive-claw', (config) => {
    engine = new RecursiveClawEngine(api, config);
    return engine;
  });

  // Register tools at plugin load time — they delegate to the engine
  const toolDefs = [
    { def: RC_PEEK_DEFINITION, handler: async (params: Record<string, unknown>) => {
      if (!engine) return { error: 'recursive-claw not initialized' };
      await engine.ensureReady();
      const { createPeekHandler } = await import('./retrieval/tools/rc-peek.js');
      return createPeekHandler(engine.getRetrieval())(params);
    }},
    { def: RC_GREP_DEFINITION, handler: async (params: Record<string, unknown>) => {
      if (!engine) return { error: 'recursive-claw not initialized' };
      await engine.ensureReady();
      const { createGrepHandler } = await import('./retrieval/tools/rc-grep.js');
      return createGrepHandler(engine.getRetrieval())(params);
    }},
    { def: RC_SLICE_DEFINITION, handler: async (params: Record<string, unknown>) => {
      if (!engine) return { error: 'recursive-claw not initialized' };
      await engine.ensureReady();
      const { createSliceHandler } = await import('./retrieval/tools/rc-slice.js');
      return createSliceHandler(engine.getRetrieval())(params);
    }},
    { def: RC_QUERY_DEFINITION, handler: async (params: Record<string, unknown>) => {
      if (!engine) return { error: 'recursive-claw not initialized' };
      await engine.ensureReady();
      const { createQueryHandler } = await import('./retrieval/tools/rc-query.js');
      return createQueryHandler(engine.getRetrieval())(params);
    }},
    { def: RC_TIMELINE_DEFINITION, handler: async (params: Record<string, unknown>) => {
      if (!engine) return { error: 'recursive-claw not initialized' };
      await engine.ensureReady();
      const { createTimelineHandler } = await import('./retrieval/tools/rc-timeline.js');
      return createTimelineHandler(engine.getRetrieval())(params);
    }},
  ];

  // OpenClaw's registerTool(tool, opts) expects:
  // - tool: object with .name property, or a factory function
  // - opts: { names?: string[], name?: string }
  for (const { def, handler } of toolDefs) {
    try {
      api.registerTool(
        {
          name: def.name,
          description: def.description,
          parameters: def.parameters,
          handler,
        },
        { name: def.name }
      );
      console.log(`[recursive-claw] Registered tool: ${def.name}`);
    } catch (err) {
      console.error(`[recursive-claw] Failed to register tool ${def.name}:`, err);
    }
  }

  console.log('[recursive-claw] Plugin registration complete');
}
