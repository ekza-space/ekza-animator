// `@ekza-studio/editor/bodies` (AUTORIG-SPEC §4.1, §9 CR-AR-1; D0): the host-agnostic panel and dialog bodies the
// Auto-Rig steps reuse — M6b's Quick Rig marker list, the clip library's card list, the character export's metadata
// fields, checklist rows and thumbnail, and the Paint Weights controls (D4 extracts them; D0's stub renders nothing).
// None imports dockview. Auto-Rig imports this subpath lazily (per step), never the package root.
export { ClipCardList, type ClipCardListProps } from './panels/clipLibrary/ClipCardList';
export { CharacterChecks, useCharacterRows } from './dialogs/export/character/CharacterChecks';
export { ThumbnailPreview } from './dialogs/export/character/ThumbnailPreview';
export { VrmMetaFields, type VrmMetaFieldsProps } from './dialogs/export/character/VrmMetaFields';
export { PaintWeightsControls, type PaintWeightsControlsProps } from './panels/paintWeights/PaintWeightsControls';
export { QuickRigPanelBody, type QuickRigPanelBodyProps } from './panels/quickRig/body';
