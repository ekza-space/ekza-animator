export { createEditorApp } from './app/createEditorApp';
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
export { tweenEdits } from './edit/tween';
export { scaleKeyValues } from './edit/valueScale';
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
export { keyTargetControls } from './workflows/targets';
export { controlVisibility } from './workflows/visibility';
// M2a A2 (M2A-SPEC §5.1, §5.5, §5.6, §5.17–§5.19): attribute channel facts, the visibility resolver, limbs, the
// virtual slider and pick-walk, for the viewport and the panels.
export {
  attrChannelsOf,
  attrDefOf,
  attrLabel,
  clampChannelValue,
  isKeyAllChannel,
  isKeyable,
  isLocked,
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
