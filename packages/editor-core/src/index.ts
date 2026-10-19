export {
  AUTOSAVE_BLOCKED_TOAST,
  AUTOSAVE_QUOTA_TOAST,
  type AutosaveClock,
  type AutosaveController,
  autosaveOf,
  MAX_ORPHANS,
  ORPHAN_MAX_AGE_MS,
  startAutosave,
} from './app/autosave';
export { createEditorApp } from './app/createEditorApp';
// M-AI (MCP-SPEC §4.1): the headless editor, the run scope helpers, presence and the actor-run constants.
export { createHeadlessEditorApp, createHeadlessServices, type HeadlessServicesOptions } from './app/headless';
export { CHANGE_JOURNAL_CAP } from './history/history';
export { NOT_AVAILABLE_YET } from './operators/builtin/stub';
export {
  AGENT_PROTECTED_SESSION_FIELDS,
  AI_LABEL_MAX,
  AI_LABEL_PREFIX,
  actorLabel,
  CANCELLED_BY_AGENT,
  GESTURE_IN_PROGRESS,
} from './operators/runner';
export { scopedCharacterOf, scopedClipOf, selectionOf, setSelectionOf } from './operators/scope';
export { createPresenceRegistry, PRESENCE_MAX_CONTROLS } from './presence/registry';
export { EDITOR_VERSION, isSampleId, SAMPLES, type SampleDef } from './workflows/samples';
export { channelDefaultOf, channelUnit } from './edit/channelMeta';
export { applyChannelEdits, beginChannelEditGesture } from './edit/channels';
export { beginKeyEditGesture } from './edit/gesture';
export {
  copyKeys,
  deleteKeys,
  ensureCurve,
  insertKeyOnCurve,
  insertTime,
  moveKeys,
  rippleMoveShift,
  scaleKeys,
  setKeyHandle,
  setTangentTypes,
  writeKeyAt,
} from './edit/keys';
// M2a (A3): the ripple scope of an edit (M2A-SPEC §5.11)
export {
  type RippleControlsProvider,
  type RippleScope,
  registerRippleControls,
  rippleControls,
  rippleCurves,
  rippleScopeOf,
} from './edit/ripple';
export { formatChannelValue, fromDisplayValue, parseNumericInput, toDisplayValue } from './edit/numeric';
export {
  beginTweenGesture,
  clampTweenAmount,
  type ResolvedTweenTarget,
  resolveTweenTarget,
  TWEEN_LIMIT,
  TWEEN_MODES,
  TWEEN_OVERSHOOT_LIMIT,
  type TweenGesture,
  tweenEdits,
} from './edit/tween';
export { scaleKeyValues } from './edit/valueScale';
export { compileWithAppEngine } from './evaluation/compile';
export { MAYA_KEYMAP } from './keymap/maya';
export type * from './operators/args';
export type { CoalescingOperatorDef, OperatorCoalescing } from './operators/runner';
export {
  BUILTIN_EXPORTERS,
  BUILTIN_IMPORTERS,
  BUILTIN_MENU_ITEMS,
  registerBuiltinOperators,
  registerBuiltins,
} from './operators/builtin';
export { defaultPrefs } from './prefs/defaults';
export { createMemoryAssetStore } from './services/assets';
export { activeClip, activeClipFrame, activeRuntime } from './session/active';
export { defaultSession } from './session/defaults';
export { restoreSelection, selectionSnapshot } from './session/selection';
export * from './types';
export { bodyPartOf } from './workflows/bodyParts';
export { loadWritePath, preloadExportPath } from './workflows/export';
export { loadImportPath, preloadImportPath } from './workflows/importLoader';
export { loadProjectArchive } from './workflows/project';
export { keyTargetControls } from './workflows/targets';
export { controlVisibility } from './workflows/visibility';
// M2a A2 (M2A-SPEC §5.1, §5.5, §5.6, §5.17–§5.19): attribute channel facts, the visibility resolver, limbs, the
// virtual slider and pick-walk, for the viewport and the panels.
export {
  attrChannelsOf,
  attrDefOf,
  attrLabel,
  channelDisplayLabel,
  clampChannelValue,
  isKeyAllChannel,
  isKeyable,
  isLocked,
  sortChannelsForDisplay,
  TRS_CHANNEL_LABEL,
} from './edit/channelMeta';
export {
  beginVirtualSlider,
  type VirtualSlider,
  virtualSliderFactor,
  virtualSliderLabel,
  virtualSliderRate,
} from './edit/virtualSlider';
export { pickWalkDispatch, pickWalkTarget } from './operators/builtin/select';
export { LIMB_NAME, limbOfControlApp, limbOfControlIn, limbsOf, watchFkOnlyRigs } from './workflows/ik';
export { controlVisibilityResolver, limbHiddenControls, limbVisibilityState } from './workflows/visibility';
