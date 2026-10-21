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
// M6a (M6A-INT-13): the Model operators chunk's eager side, and its menu items for tests and lazy code (the editor
// registers them once the chunk has loaded).
export {
  loadModelOperators,
  MODEL_TOOLS_LOADING,
  modelOperators,
  whenModelOperatorsLoaded,
} from './operators/builtin/modelOps';
export { MODEL_MENU_ITEMS } from './operators/builtin/modelMenus';
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
// M6a (M6A-SPEC §4.6): workspaces, the mesh runtime registry and operator wrappers, the blob store, the component
// selection service and the stubs of the services B10–B12b land.
export { createCapture } from './app/factories/capture';
export { createExtrude } from './app/factories/extrude';
export { historyLabels } from './history/history';
export {
  attachMeshes,
  BUDGET_TOAST,
  type CommitContext,
  type GcReport,
  jointPaletteOf,
  type KernelMeshRuntimes,
  kernelMeshes,
  type LastSetOp,
  loadMeshKernel,
  type MeshKernel,
  meshKernel,
  morphNamesOf,
  type PaletteJoint,
  readSkin,
  refJointsOf,
  type RunSettings,
  type SkinRead,
  SWEEP_INTERVAL_MS,
  uniqueMeshName,
  worldPlacement,
} from './mesh';
export { adjustedRun, runSeed, runSeedOf, runSettings } from './mesh/seed';
export { MESH_EXTRA_ARGS, meshOperator, meshSetOperator } from './mesh/operator';
export { MESH_OPERATORS } from './operators/builtin/mesh';
// M6a B8 (M6A-SPEC §5.21, §5.23): character meshes made editable, their edits and the rebuilt display.
export { lastMakeEditableReport } from './operators/builtin/makeEditable';
export { characterEdits, displayContainer } from './workflows/exportModel';
export {
  type AssetMeshRow,
  assetMeshId,
  assetMeshRows,
  type CharacterDisplaySource,
  characterMeshRecords,
  createMeshDisplay,
  DISPLAY_DEBOUNCE_MS,
  DISPLAY_IDLE_TIMEOUT_MS,
  type DisplayTimers,
  hasMeshEdits,
  isEditedMesh,
  type MeshDisplayController,
} from './workflows/meshDisplay';
// M6a B13 (M6A-SPEC §5.13, §5.16, §5.19, §5.26): palettes, templates, live primitives, image planes, scene objects.
export {
  activeSwatchOf,
  DEFAULT_PALETTE_ID,
  defaultSwatchId,
  nextSlot,
  parseHex,
  swatchIdFor,
  toHex,
} from './operators/builtin/palette';
export { paintRefusal } from './operators/builtin/paintRules';
export {
  DEFAULT_GRIP,
  FROZEN_REASON,
  HUMANOID_PRESETS,
  type HumanoidPreset,
  primitiveParams,
  TEMPLATE_PARAMS,
  TEMPLATES,
  type TemplateId,
} from './operators/builtin/templates';
export {
  defaultOffset,
  imageBytesOf,
  imageExt,
  LOCKED_REASON,
  MAX_IMAGE_BYTES,
  ORTHO_CAMERAS,
  pendingImagePlaneCamera,
} from './operators/builtin/imagePlane';
export {
  BUDGET_PRESETS,
  isAncestorOrSelf,
  objectWorld,
  type SceneObject,
  sceneObject,
  subtree,
  TOON_REASON,
  topmost,
} from './operators/builtin/scene';
export { ANIMATE_ONLY_REASON } from './operators/builtin/keymapShadows';
export { NOT_AVAILABLE_YET } from './operators/builtin/stub';
export type { LastRunRecorder } from './operators/runner';
export { defaultModelingPrefs } from './prefs/defaults';
export { createComponentSelectionService } from './selection';
export { addBlobSource, type BlobSource, createMemoryBlobStore, type MemoryBlobStore } from './services/blobs';
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
  MAKE_EDITABLE_HINT,
  MODEL_ONLY_REASON,
  SELECT_A_MESH_FIRST,
  targetMode,
} from './operators/builtin/mode';
export { objectsDrawnIn } from './operators/builtin/hide';
export { COMPONENT_MODE_FIRST, EDGE_MODE_FIRST, NOTHING_SELECTED } from './operators/builtin/selectMesh';
export {
  type ClickRecord,
  type ComponentServiceInternals,
  COMPONENT_TOOLS,
  closedExpectedOf,
  componentInternals,
  duplicateSlotsOf,
  facesTouching,
  type MeshCheckOptions,
  meshCheckOptions,
  type ModelPointerProbe,
  modelPointer,
  provideModelPointer,
} from './selection/component';
export { recordHide, sameSelection, selectionGesture, undoSelectionOn } from './selection/component/steps';
export { repairModel } from './session/repair';
// M6a (B11, M6A-SPEC §5.7, §5.10, §8.5, §8.6): typed parameter values, the LastRun recorder and tracker, Adjust Last
// and Repeat Last helpers, the numeric capture window and the Last-op card's open state, the mesh op registration.
// ./edit/paramInput and ./operators/builtin/lastopEngine are the B11 runtime chunk (§5.27): only lazy code (the card
// and option-box views, the test API) imports their exports, so the eager route drops them; eager code reaches the
// engines through `loadOpsRuntime`.
export {
  type CaptureKeyEvent,
  type CaptureMessage,
  bindCapture,
  createNumericCapture,
  dismissLastOpCard,
  ENTRY_DISCARDED,
  type InputsFieldSelection,
  type LastOpCardState,
  lastOpCardState,
  type NumericCapture,
  numericParams,
  openLastOpCard,
  primaryVisibleParam,
  resetLastOpCard,
  selectedInputsField,
  selectInputsField,
  setLastOpCardExpanded,
  subscribeInputsField,
  subscribeLastOpCard,
  visibleParams,
} from './edit/capture';
export {
  clampParamValue,
  formatParamValue,
  nonDefaultParams,
  type ParamInputResult,
  paramEditText,
  paramSliderRate,
  parseParamInput,
} from './edit/paramInput';
export { repeatArgs } from './operators/builtin/edit';
export {
  activateTool,
  adjustingOperator,
  adjustLastRun,
  adjustProblem,
  attachLastRunTracker,
  closeLastRun,
  type FinishedRun,
  LAST_RUN_CLOSED,
  lastAdjustRefusal,
  lastRunWarnings,
  liveLastRun,
  loadOpsRuntime,
  NO_OPERATION_TO_ADJUST,
  NOTHING_TO_REPEAT,
  type OpsRuntime,
  opsRuntime,
  pendingAdjust,
  recordLastRun,
  recordsLastRun,
} from './operators/builtin/lastop';
export {
  adjustedArgs,
  beginCardPreview,
  CARD_PREVIEW_BUDGET_MS,
  type CardPreview,
  coercePartial,
} from './operators/builtin/lastopEngine';
export {
  INTERNAL_MESH_OPS,
  MESH_OP_ALIASES,
  MESH_OP_TOOLS,
  MESH_OP_UNDO_LABELS,
  registeredMeshOperator,
  registeredMeshSetOperator,
  WHOLE_MESH_OPS,
  wholeMeshRun,
} from './operators/builtin/mesh';
export { coerceRunArgs, recordNoLastRun } from './operators/runner';
// M6a (B9): the pane display operators' vocabulary (view.shading, view.display.set, view.display.toggle).
export { BOOLEAN_DISPLAY_FLAGS, displayPatchProblem, SHADINGS } from './operators/builtin/workspace';
// M6a (B12a, M6A-SPEC §5.13–§5.15, §6.2): symmetry, soft selection and selection settings, snapping, the transform
// orientation, pivots, Freeze/Reset Transformations and object transforms.
export {
  CONSTRAINTS_LATER,
  DRAG_STYLE_LATER,
  MODEL_SETTINGS_REASON,
  SOFT_CURVES,
  SOFT_FALLOFFS,
  softPatch,
} from './operators/builtin/softSelect';
export { softWeightsOf } from './operators/builtin/softWeights';
export { SYMMETRY_LABELS, SYMMETRY_MODES, symmetryOf, symmetryTargets } from './operators/builtin/symmetry';
export {
  componentSpaceOn,
  SNAP_KINDS,
  SNAP_LABELS,
  type SnapKind,
  setComponentSpace,
  setTweakHandle,
  subscribeTransformSpace,
  type TransformSpace,
  type TransformToolKind,
  transformSpace,
} from './operators/builtin/snap';
export {
  childrenOf,
  defaultObjects,
  FREEZE_PARAMS,
  FREEZE_SKINNED,
  MESH_LOADING,
  NOTHING_TO_FREEZE,
  NOTHING_TO_TRANSFORM,
  type ObjectRecord,
  objectRecord,
  objectTableOf,
  placementArg,
  placementChangeLabel,
} from './operators/builtin/pivot';
// M6a (B12b, M6A-SPEC §5.8): the extrude session's shim and hooks, the Model tools' help-line channel (eager), and the
// session engine (./operators/builtin/extrudeEngine, a lazy chunk: only lazy code — the viewport's topology tools and
// the test API — imports its exports, so the eager route drops them; eager code reaches it through `loadExtrudeEngine`).
export {
  bindExtrude,
  type ExtrudeEngine,
  type ExtrudeEngineHost,
  extrudeEngineModule,
  type ExtrudeSessionShim,
  loadExtrudeEngine,
  type ModelToolMessage,
  onModelHelp,
  sayModelHelp,
} from './operators/builtin/extrudeSession';
export {
  type AbsorbDelta,
  absorbArgs,
  beginSmartExtrude,
  EXTRUDE_IDENTITY,
  EXTRUDE_REMOVED,
  extrudeFirstDrag,
  type ExtrudeManipFrame,
  extrudeManipulatorFrame,
  type Frame as ExtrudeFrame,
  type FrameMirror as ExtrudeFrameMirror,
  isIdentityExtrude,
  manipulatorFrame,
  placementLinear,
  toWorld,
  worldAxes,
} from './operators/builtin/extrudeEngine';
// ---------- M6b (M6B-SPEC §4.6, §0.5; C0 baselines and hooks) ----------
export { type ChannelSources, previewValues, registerChannelSourceProvider } from './evaluation/rigSource';
export { defaultRiggingPrefs } from './prefs/defaults';
export { DEFAULT_BRUSH, defaultRigSession } from './session/rig';
export { isRigWorkspaceOperator, lazyOperatorChunk, RIG_MENUS, RIG_STATUS_GROUPS, rigStatus } from './workspaces/rig';
// M6b C7 (rig shell): the Validation service's shapes, the checklist, the Rig keymap rows and the mode rules. Values
// here are read by lazy UI code and tests only (the rig-workspace chunk creates the services).
export {
  type ChecklistGlyph,
  type ChecklistStep,
  checklistSummary,
  DEFAULT_PROFILE,
  profileKind,
  RIG_PROFILES,
  type RigValidation,
  rigChecklist,
  rigValidation,
} from './rig/validation';
export { activeCharacter, LEFT_RIG_REASON, TEST_POSE_TOAST } from './rig/chunk/workspace';
export { beginTestPoseGesture } from './rig/testPose/gesture';
export { KEYING_CHORDS, RIG_KEYMAP, RIG_SCOPE } from './keymap/maya.rig';
export { BIND_A_MESH_FIRST, MODE_MASKS, RIG_ONLY_REASON } from './operators/builtin/rig/mode';
export { type ChannelEditRedirect, registerChannelEditRedirect } from './evaluation/rigSource';
export { type CharacterRuntimeChunk, loadCharacterRuntime } from './characters/runtimeChunk';
export { ARRIVES_AFTER_MVP } from './operators/builtin/rig/stub';
