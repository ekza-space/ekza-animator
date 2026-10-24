// @ekza-studio/ui/touch: the touch kit of Ekza Studio's Simple layout (STUDIO-TOUCH-SPEC §20.3 item 14, work
// package T4). Its own subpath, never re-exported from the package root, so Studio Pro's routes pay nothing for it.
// Render the components inside a touch scope (`TouchRoot`, or `touchScopeProps` on the shell's root): styles.css
// `[data-density="touch"]` gives them 44 px targets, 16 px input text, gutters, safe-area insets, the focus ring
// and the Text & touch size. Nothing registers on import.
export {
  ActionChip,
  type ActionChipProps,
  ToggleChip,
  type ToggleChipProps,
  ValueChip,
  type ValueChipProps,
} from './chips';
export {
  clampUiScale,
  prefersReducedMotion,
  slopFor,
  TOUCH,
  type TouchScopeProps,
  touchScopeProps,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
} from './constants';
export { Glyph, type GlyphName } from './glyphs';
export {
  type ArcInput,
  type ArcLayout,
  arcLayout,
  type Box,
  boxAt,
  COMPASS,
  type CompassSlot,
  type Detent,
  DETENTS,
  detentHeights,
  fitRow,
  nextDetent,
  type Point,
  ringLayout,
  rovingIndex,
  slotToward,
  snapDetent,
} from './layout';
export { type LoupeCandidate, LoupeChips, type LoupeChipsProps, type LoupeHandle } from './loupe';
export { Numpad, type NumpadProps } from './numpad';
export {
  evaluateExpression,
  keyFromKeyboard,
  type NumpadKey,
  type NumpadState,
  numpadInit,
  numpadReduce,
  numpadText,
} from './numpad-model';
export { installTouchPolicy, TOUCH_POLICY_CLASS } from './policy';
export {
  createPressRecognizer,
  type PressEvent,
  type PressOptions,
  type PressPhase,
  type PressRecognizer,
} from './press';
export {
  clampValue,
  createScrub,
  decimalsOf,
  formatValue,
  keyStep,
  roundTo,
  type ScrubOptions,
  type ScrubSession,
  scrubFactor,
} from './scrub';
export { Segmented, type SegmentedItem, type SegmentedProps } from './segmented';
export { Sheet, SheetGroup, type SheetProps, SheetRow } from './sheet';
export { Stepper, type StepperProps } from './stepper';
export {
  Cluster,
  TouchButton,
  type TouchButtonProps,
  type TouchButtonVariant,
  TouchIconButton,
  type TouchIconButtonProps,
  TouchRoot,
  type TouchRootProps,
  touchButtonClass,
} from './surfaces';
export {
  type ThumbChoice,
  ThumbKey,
  type ThumbKeyProps,
  type ThumbMeaning,
  thumbKeyName,
  useThumbKey,
} from './thumb-key';
export {
  THUMB_INITIAL,
  type ThumbEvent,
  type ThumbLatch,
  type ThumbState,
  thumbActive,
  thumbReduce,
} from './thumb-model';
export { createToastStore, type ToastInput, type ToastItem, type ToastStore, type ToastTimers } from './toast-store';
export { ToastRegion, useToasts } from './toasts';
export { type LongPressCallbacks, type LongPressHandlers, useLongPress } from './use-long-press';
export {
  Petal,
  type PetalProps,
  ringSlots,
  VerbBar,
  type VerbBarProps,
  type VerbItem,
  VerbRing,
  type VerbRingProps,
} from './verbs';
