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
// M6a (M6A-SPEC §5.17, §7; B0b): hierarchical key scopes and the tool-modifier sheet.
export {
  chordInput,
  keyScopeChain,
  MODEL_SCOPE,
  RESERVED_MODAL_KEYS,
  resolveChord,
  type ScopeChainInput,
} from './keymap/scopes';
export { MODEL_MENUS } from './operators/builtin/menus';
export {
  TOOL_HOLD_CODES,
  TOOL_MODIFIERS,
  type ToolModifierDoc,
  type ToolModifierPart,
  toolModifierKeys,
} from './keymap/toolModifiers';
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
// M6a (M6A-SPEC §4.6): workspaces, the mesh runtime registry and operator wrappers, the blob store, the component
// selection service and the stubs of the services B10–B12b land.
export { createCapture } from './app/factories/capture';
export { createExtrude } from './app/factories/extrude';
export { historyLabels } from './history/history';
export { type KernelMeshRuntimes, loadMeshKernel, type MeshKernel, meshKernel } from './mesh';
export { MESH_EXTRA_ARGS, meshOperator, meshSetOperator } from './mesh/operator';
export { MESH_OPERATORS } from './operators/builtin/mesh';
export { ANIMATE_ONLY_REASON } from './operators/builtin/keymapShadows';
export { NOT_AVAILABLE_YET } from './operators/builtin/stub';
export type { LastRunRecorder } from './operators/runner';
export { defaultModelingPrefs } from './prefs/defaults';
export { createComponentSelectionService } from './selection';
export { createMemoryBlobStore, type MemoryBlobStore } from './services/blobs';
export { defaultModelSession } from './session/defaults';
export { restoreSelectionPart, type StoredSelectionSnapshot } from './session/selection';
export {
  ANIMATE_MENUS,
  ANIMATE_STATUS_GROUPS,
  ANIMATE_WORKSPACE,
  animateStatus,
  BUDGET_TRIS,
  BUILTIN_WORKSPACES,
  DEFAULT_WORKSPACE_VIEWS,
  isTransformTool,
  LEFT_MODEL_REASON,
  MODEL_STATUS_GROUPS,
  MODEL_WORKSPACE,
  meshBudget,
  modelStatus,
  type PaneDisplayPort,
  paneDisplayPort,
  providePaneDisplay,
  provideShellOverlays,
  REVIEW_WORKSPACE,
  RIG_WORKSPACE,
  registerBuiltinWorkspaces,
  type ShellOverlayPort,
  shellOverlayPort,
  switchWorkspace,
  WORKSPACE,
  workspaceProblem,
  workspaceTabs,
} from './workspaces';
// M6a (B10): component modes, the selection service's internals, the pointer probe, hide/isolate and selection steps.
export {
  isEditableMesh,
  MAKE_EDITABLE_FIRST,
  MODEL_ONLY_REASON,
  SELECT_A_MESH_FIRST,
  targetMode,
} from './operators/builtin/mode';
export { objectsDrawnIn } from './operators/builtin/hide';
export { COMPONENT_MODE_FIRST, EDGE_MODE_FIRST, NOTHING_SELECTED } from './operators/builtin/selectMesh';
export {
  type ClickRecord,
  type ComponentServiceInternals,
  componentInternals,
  facesTouching,
  type ModelPointerProbe,
  modelPointer,
  provideModelPointer,
} from './selection/component';
export { recordHide, sameSelection, selectionGesture, undoSelectionOn } from './selection/component/steps';
export { repairModel } from './session/repair';
// M6a (B9): the pane display operators' vocabulary (view.shading, view.display.set, view.display.toggle).
export { BOOLEAN_DISPLAY_FLAGS, displayPatchProblem, SHADINGS } from './operators/builtin/workspace';
