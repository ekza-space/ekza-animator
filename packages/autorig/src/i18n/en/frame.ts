// English strings of the wizard frame: header, stepper, footer, menu, step entry and the progress reasons
// (AUTORIG-SPEC §5.1, §4.3, §8.2, §8.4; D3 owns the table).
import type { MessageTable } from '../index';

export const frame = {
  product: 'Auto-Rig',
  untitled: 'untitled',
  // steps (stepper labels, the step heading)
  stepModel: 'Model',
  stepMarkers: 'Markers',
  stepRig: 'Rig',
  stepAnimations: 'Animations',
  stepExport: 'Export',
  stepsLabel: 'Steps',
  stepDone: (label: string) => `${label}, done`,
  stepBlocked: (label: string, why: string) => `${label}, not available yet: ${why}`,
  // header
  rename: 'Rename the character',
  renameField: 'Character name',
  undo: 'Undo',
  undoStep: (label: string) => `Undo ${label}`,
  redo: 'Redo',
  redoStep: (label: string) => `Redo ${label}`,
  openStudio: 'Open in Studio',
  openStudioTitle: 'Continue with the full editor (same document, same undo history)',
  more: 'More',
  // pane badges (the pose view and a playing library preview, as Studio's HUD shows them)
  badgeBindPose: 'BIND POSE',
  badgeTestPose: 'TEST POSE',
  badgePreview: (clip: string) => `PREVIEW ${clip}`,
  // ⋯ menu
  menuNew: 'New',
  menuOpen: 'Open project…',
  menuSave: 'Save project',
  menuStudioTab: 'Open in Studio (new tab)',
  menuSwitch: 'Switch mode…',
  menuPalette: 'Command palette…',
  menuPrefs: 'Preferences',
  menuKeys: 'Keyboard shortcuts',
  menuAbout: 'About & credits',
  newConfirm: 'Start a new character? Unsaved work is kept in autosave.',
  // footer
  back: 'Back',
  next: (label: string) => `Next: ${label}`,
  working: 'Working…',
  // progress reasons (`blocked`)
  blockedNoModel: 'Load a model first',
  blockedNoSkeleton: 'Create the skeleton first (Markers)',
  blockedNotBound: 'Rig the character first (Auto-rig)',
  blockedChecking: 'Checking the rig…',
  blockedRow: (message: string) => `Fix first: ${message}`,
  // the steps that have not landed yet in this build (D4–D6 replace them)
  stubTitle: (label: string) => `${label} arrives soon`,
  stubBody: 'This step is not part of this build yet. Open in Studio to continue with the full editor.',
  alreadyRigged:
    'This avatar is already rigged. Rig and weight edits on imported avatars arrive later — Open in Studio to animate by hand.',
  // busy and failures
  busy: (label: string) => label,
  failed: (label: string, message: string) => `${label}: ${message}`,
  noWebGl: 'Auto-Rig needs 3D graphics (WebGL 2)',
  // sheets
  keysTitle: 'Keyboard shortcuts',
  aboutTitle: 'About Auto-Rig',
  aboutBody:
    'Auto-Rig is the simple mode of Ekza Studio: load a model, place a few markers, get a skinned skeleton, try ' +
    'animations and export a VRM for OMOBA and Ekza Space. Everything runs in your browser; your files are never uploaded.',
  aboutCredits: 'Credits and licences',
  aboutSource: 'Source code',
  close: 'Close',
  keyUndo: 'Undo / redo',
  keyPrimary: 'The step’s main button',
  keyGoto: 'Go to step 1…5',
  keyEscape: 'Stop the preview, cancel the gesture, close the sheet',
  keyFrame: 'Frame the model (over a view)',
  keyFullscreen: 'Full screen',
} as const satisfies MessageTable;
