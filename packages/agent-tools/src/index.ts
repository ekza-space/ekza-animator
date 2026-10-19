// @ekza-animator/agent-tools (MCP-SPEC §4.4, §4.5): one tool layer for every host — the open editor tab, the headless
// Node server and (later) an in-app assistant run the same tool code over `EditorApp`. No DOM, no Node, no MCP SDK.
export * from './types';
// runtime, resolver, envelope, errors, sanitiser, budgets (D0 minimal runtime; P2 completes it)
export {
  composeLabel,
  createAgentToolRuntime,
  DEFAULT_CONFIRM_TIMEOUT_MS,
  DEFAULT_GESTURE_WAIT_MS,
  INTENT_MAX_CHARS,
  invalidArgs,
  issuePath,
  LABEL_MAX,
  RUNTIME_DEFAULTS,
} from './runtime/runtime';
export { createRevisionTracker } from './runtime/revisions';
export {
  controlKeyOf,
  createResolver,
  editDistance,
  opaqueControlKey,
  type ResolverOptions,
  SEC_NODE_MAX,
} from './resolve/resolver';
export { finishResult, MAX_CANDIDATES, type ResultBudget, sanitizeError } from './envelope/envelope';
export { failureFrom, failureFromEkza, finishedValue } from './envelope/errors';
export {
  isClean,
  NAME_MAX_CHARS,
  PROSE_MAX_CHARS,
  QUOTE_MAX_CHARS,
  quoteName,
  sanitizeDeep,
  sanitizeText,
} from './sanitize/sanitize';
export {
  type BudgetOutcome,
  CHARS_PER_TOKEN,
  enforceBudget,
  type JsonSchema,
  MAX_WARNINGS,
  OVER_BUDGET_HINT,
  outputJsonSchemaOf,
  TRUNCATED_NEXT,
  tokensOf,
  TRUNCATED_FIELD,
  WARNING_MAX_CHARS,
} from './budget/budget';
// tools, manifest, lint
export { allTools, CORE_TOOL_COUNT, readyTools, STRETCH_TOOL_COUNT } from './tools/catalogue';
export { BUDGETS, defineTool, notAvailableYet, withTruncated } from './tools/define';
export { buildManifest, canonicalJson, manifestAccess, manifestFileText, manifestToolOf } from './manifest/manifest';
export { firstSentence, lintTool, lintTools, TOOL_NAME, TOOL_NOUNS, UNIT_SUFFIX } from './manifest/lint';
export * as schemas from './schemas/common';
// operator policy and wire schemas
export { agentPolicyOf, isClassified, OPERATOR_POLICY, UNCLASSIFIED_REASON } from './policy';
export { OPERATOR_WIRE, type OperatorWire, type OperatorWireMap, type WireUnit } from './operators/wire';
// bridge protocol
export * from './bridge/protocol';
// MCP text: instructions, prompts, resources
export { SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_MAX_CHARS } from './text/instructions';
export { PROMPTS, type PromptArgumentDef, type PromptDef } from './text/prompts';
export {
  GUIDE_TEXT,
  RESOURCE_TEMPLATES,
  type ResourceDef,
  type ResourceTemplateDef,
  STATIC_RESOURCES,
} from './text/resources';
