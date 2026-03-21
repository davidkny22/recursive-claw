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

export function registerTools(api: OpenClawPluginAPI, engine: RetrievalEngine): void {
  api.registerTool(RC_PEEK_DEFINITION.name, {
    description: RC_PEEK_DEFINITION.description,
    parameters: RC_PEEK_DEFINITION.parameters,
    handler: createPeekHandler(engine),
  });

  api.registerTool(RC_GREP_DEFINITION.name, {
    description: RC_GREP_DEFINITION.description,
    parameters: RC_GREP_DEFINITION.parameters,
    handler: createGrepHandler(engine),
  });

  api.registerTool(RC_SLICE_DEFINITION.name, {
    description: RC_SLICE_DEFINITION.description,
    parameters: RC_SLICE_DEFINITION.parameters,
    handler: createSliceHandler(engine),
  });

  api.registerTool(RC_QUERY_DEFINITION.name, {
    description: RC_QUERY_DEFINITION.description,
    parameters: RC_QUERY_DEFINITION.parameters,
    handler: createQueryHandler(engine),
  });

  api.registerTool(RC_TIMELINE_DEFINITION.name, {
    description: RC_TIMELINE_DEFINITION.description,
    parameters: RC_TIMELINE_DEFINITION.parameters,
    handler: createTimelineHandler(engine),
  });
}
