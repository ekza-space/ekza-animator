// `@ekza-studio/editor/models` (STUDIO-TOUCH-SPEC §20.3 item 9, §20.6; T5c): the React-free view models of Studio
// Pro's panels that the Halo shell reads, so its sheets show the same rows, numbers and labels as Pro. Imported only by
// `@ekza-studio/halo` (oxlint, check-deps).
//
// Every module here costs `/editor` bytes as soon as Halo imports it, eagerly or lazily, when `/editor` loads it
// eagerly: a second chunk group stops Turbopack from scope-hoisting it into `/editor`'s chunk (AR-D3-1, ST-B1). So the
// list holds what Halo's first stages need (T6a, T6b, T7) plus models `/editor` loads lazily (0 B), each measured
// (docs/wp-notes/halo-t5c.md, ST-T5C-*). Left out on purpose: the rig Outliner tree (`outliner/model`, +241 B), the
// Graph Editor model (+550 B; Halo's Curves get their own adapter, T10), Channels `states` (+80 B; Halo words key
// states itself) and `nudge` (+178 B; arrow-key bursts, Halo's steppers are operator runs), `channels/kit/kernel`
// (aliases of editor-core and doc helpers: import those directly; its `readVrmLicense` is io's). Adding a module means
// measuring it against `/editor` first.

// The Model Outliner's tree (Scene sheet; lazy in Pro: 0 B).
export {
  assetKey,
  buildModelOutlinerRows,
  type ContainerMeshes,
  characterKey,
  containerMeshes,
  dropTargetOf,
  meshesKey,
  type ModelOutlinerDoc,
  type ModelOutlinerRow,
  type ModelOutlinerView,
  objectKey,
  ownerKeyOf,
  planeKey,
  REFERENCE_KEY,
  readModelOutlinerDoc,
  rowId,
  SCENE_KEY,
  type SceneObjectRecord,
} from './panels/outliner/modelTree';
export { nextObjectSelection, selectObjects } from './panels/outliner/sceneSelection';

// The Channels readout (Numbers, Echo chips: every chip equals the Channels readout, AS-ST-19; +207 B).
export {
  type ChannelCell,
  ChannelReadout,
  channelText,
  type FrameScheduler,
  PROXY_CELL,
  type ReadoutTargets,
} from './panels/channels/readout';

// Clip settings (the animation's Settings, Numbers › Animation; +330 B with the readout).
export {
  CLIP_NAME_MAX,
  type ClipSettingsDraft,
  checkDraft,
  type DraftCheck,
  type DraftField,
  draftFromClip,
  EMPTY_SOURCE,
  FPS_PRESETS,
  type FpsMode,
  formatDuration,
  formatFps,
  fpsFromNumber,
  fpsToNumber,
  LICENSE_PRESETS,
  MAX_FPS,
  MAX_TAGS,
  parseTags,
  REDISTRIBUTABLE_LABEL,
  ROOT_MOTION_HINT,
  ROOT_MOTION_LABEL,
  redistributionHint,
  SLOT_VOCABULARY,
  type SourceDraft,
  sameFps,
  sourceDraft,
  validateClipName,
} from './panels/clips/settings';

// The colour palette (Paint, T8; lazy in Pro: 0 B).
export {
  byOrder,
  contrastOn,
  leadMeshId,
  MAX_RECENTS,
  palettesOf,
  pushRecent,
  SWATCHES_PER_ROW,
  shownPalette,
  swatchesOf,
  targetMeshIds,
  usageLine,
  usedSlots,
} from './panels/palette/model';
