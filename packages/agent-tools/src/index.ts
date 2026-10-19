// @ekza-animator/agent-tools (MCP-SPEC §4.4, §4.5): one tool layer for every host — the open editor tab, the headless
// Node server and (later) an in-app assistant run the same tool code over `EditorApp`. No DOM, no Node, no MCP SDK.
export * from './types';
// runtime, resolver, envelope, errors, sanitiser, budgets (D0 minimal runtime; P2 completes it)
export {
  actorRevisionsOf,
  type AgentToolRuntimeHandle,
  type CheckpointRecord,
  composeLabel,
  createAgentToolRuntime,
  CURSOR_MAX,
  type CursorRecord,
  DEFAULT_CONFIRM_TIMEOUT_MS,
  DEFAULT_GESTURE_WAIT_MS,
  FOCUS_LINGER_MS,
  INTENT_MAX_CHARS,
  invalidArgs,
  issuePath,
  LABEL_MAX,
  PROGRESS_MAX_CHARS,
  PROGRESS_MIN_INTERVAL_MS,
  QUEUE_MAX,
  RATE_BURST,
  RATE_PER_SECOND,
  randomBase62,
  RUNTIME_DEFAULTS,
  type RuntimeState,
  runtimeStateOf,
  WAITING_FOR_CONFIRM,
  WAITING_FOR_DRAG,
  WAITING_FOR_REDO,
} from './runtime/runtime';
export { type ActorRevisionTracker, createRevisionTracker, REVISION_MEMORY } from './runtime/revisions';
export {
  type Addressed,
  addressed,
  atFrame,
  clipInfo,
  labelName,
  plural,
  staleCheck,
  undoOf,
  valueOf,
  writeResult,
} from './runtime/toolkit';
export {
  AGENT_RANGE_MAX,
  type ChannelTargetRef,
  channelTargets,
  checkFrames,
  checkReadFrames,
  clipRecordOf,
  curveOf,
  curvesOfTargets,
  keyableChannelsOf,
  keySelection,
  keysOfTargets,
  limbOf,
  rangeArg,
  resolveControls,
  type TargetsArg,
} from './resolve/targets';
export * as units from './units/units';
export * as poses from './units/pose';
// data of the reads that resources and the bridge serve too (§5.20.3)
export {
  actorKindOf,
  limbModes,
  SELECTED_CONTROLS_MAX,
  SELECTED_KEYS_MAX,
  sceneSummaryData,
  userSelectionOf,
  userTimeOf,
} from './tools/scene/summary';
export { AXIS_HINT_DEG, describeMove, describeRig } from './tools/rig/describe';
export { infinityName, keyFlags } from './tools/keys/read';
export { curveStats } from './tools/curves/summary';
export { DELETE_CONFIRM_KEYS, WRITE_KEYS_MAX } from './tools/keys/write';
export { SEAM_C0, SEAM_C1 } from './tools/clip/run';
export { CHECKPOINTS_MAX, planRevert } from './tools/history/run';
export {
  controlKeyOf,
  createResolver,
  editDistance,
  opaqueControlKey,
  type ResolverOptions,
  SEC_NODE_MAX,
} from './resolve/resolver';
export { finishResult, MAX_CANDIDATES, type ResultBudget, sanitizeError } from './envelope/envelope';
export { failureFrom, failureFromEkza, finishedValue, scrubPaths } from './envelope/errors';
export {
  isClean,
  NAME_MAX_CHARS,
  NEST_MAX_DEPTH,
  PROSE_MAX_CHARS,
  QUOTE_MAX_CHARS,
  quoteName,
  sanitizeDeep,
  sanitizeText,
  toWellFormed,
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
export { agentPolicyOf, isClassified, OPERATOR_POLICY, tablePolicyOf, UNCLASSIFIED_REASON } from './policy';
export { OPERATOR_WIRE, type OperatorWire, type OperatorWireMap, type WireUnit } from './operators/wire';
// bridge protocol
export * from './bridge/protocol';
// MCP text: instructions, prompts, resources
export { SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_MAX_CHARS } from './text/instructions';
export { PLAN_CLOSE, PROMPTS, type PromptArgumentDef, type PromptDef, planNumber, planWord } from './text/prompts';
export {
  GUIDE_MAX_WORDS,
  GUIDE_TEXT,
  RESOURCE_TEMPLATES,
  type ResourceDef,
  type ResourceTemplateDef,
  STATIC_RESOURCES,
} from './text/resources';
