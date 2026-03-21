import type { OpenClawPluginAPI } from '../../types.js';
import type { RetrievalEngine } from '../retrieval-engine.js';
import {
  RC_PEEK_DEFINITION,
  RC_GREP_DEFINITION,
  RC_SLICE_DEFINITION,
  RC_QUERY_DEFINITION,
  RC_TIMELINE_DEFINITION,
} from './tool-definitions.js';
import { createPeekHandler } from './rc-peek.js';
import { createGrepHandler } from './rc-grep.js';
import { createSliceHandler } from './rc-slice.js';
import { createQueryHandler } from './rc-query.js';
import { createTimelineHandler } from './rc-timeline.js';

/**
 * Register all retrieval tools with the OpenClaw plugin API.
 * Note: In production, tools are registered in plugin.ts at load time.
 * This function is kept for testing and direct registration use cases.
 */
export function registerTools(api: OpenClawPluginAPI, engine: RetrievalEngine): void {
  const defs = [
    { ...RC_PEEK_DEFINITION, handler: createPeekHandler(engine) },
    { ...RC_GREP_DEFINITION, handler: createGrepHandler(engine) },
    { ...RC_SLICE_DEFINITION, handler: createSliceHandler(engine) },
    { ...RC_QUERY_DEFINITION, handler: createQueryHandler(engine) },
    { ...RC_TIMELINE_DEFINITION, handler: createTimelineHandler(engine) },
  ];

  for (const def of defs) {
    api.registerTool(def, { name: def.name });
  }
}
