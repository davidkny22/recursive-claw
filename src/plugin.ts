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
 * Tools registered at load time with execute(_id, params) signature.
 * Tools delegate to engine which auto-bootstraps on first call.
 *
 * Note: dynamic import() is standard ESM deferred loading, not code gen.
 */

type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

function makeExecutor(engine: { current: RecursiveClawEngine | null }, importFn: () => Promise<{ default?: never } & Record<string, (eng: unknown) => ToolHandler>>, handlerName: string) {
  return async (_id: string, params: Record<string, unknown>) => {
    if (!engine.current) return { content: [{ type: 'text', text: 'recursive-claw not initialized' }] };
    await engine.current.ensureReady();
    const mod = await importFn();
    const createHandler = Object.values(mod)[0] as (eng: unknown) => ToolHandler;
    const result = await createHandler(engine.current.getRetrieval())(params);
    return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
  };
}

// Module-level engine ref — persists across register() calls
// (OpenClaw may call register() multiple times for different agent spawns)
let globalEngine: RecursiveClawEngine | null = null;

export default function register(api: OpenClawPluginAPI): void {
  api.registerContextEngine('recursive-claw', (config) => {
    console.log('[recursive-claw] Context engine factory called');
    globalEngine = new RecursiveClawEngine(api, config);
    return globalEngine;
  });

  const tools = [
    { def: RC_PEEK_DEFINITION, mod: () => import('./retrieval/tools/rc-peek.js') },
    { def: RC_GREP_DEFINITION, mod: () => import('./retrieval/tools/rc-grep.js') },
    { def: RC_SLICE_DEFINITION, mod: () => import('./retrieval/tools/rc-slice.js') },
    { def: RC_QUERY_DEFINITION, mod: () => import('./retrieval/tools/rc-query.js') },
    { def: RC_TIMELINE_DEFINITION, mod: () => import('./retrieval/tools/rc-timeline.js') },
  ];

  for (const { def, mod } of tools) {
    const executeFn = async (_id: string, params: Record<string, unknown>) => {
      try {
        if (!globalEngine) return { content: [{ type: 'text', text: 'recursive-claw engine not initialized' }] };
        await globalEngine.ensureReady();
        const module = await mod();
        const createHandler = Object.values(module)[0] as (eng: unknown) => ToolHandler;
        const result = await createHandler(globalEngine.getRetrieval())(params);
        return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `rc tool error: ${err}` }] };
      }
    };

    try {
      api.registerTool(
        {
          name: def.name,
          description: def.description,
          parameters: def.parameters,
          execute: executeFn,
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
