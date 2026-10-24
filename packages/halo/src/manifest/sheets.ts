// The sheets' contract (STUDIO-TOUCH-SPEC §4.1, §6.3–§6.8, §20.2; T6b): the sections a `SurfaceRef` may name (§20.5
// test 7: "a sheet binding exists") and what the frame hands a sheet. The frame (T6a) owns where a sheet docks — the
// right edge on wide containers, the bottom in portrait and on phones — and which one is open; a sheet owns its body.
// Every sheet is lazy (§20.6): `sheetLoaders.ts` holds the `import()`s, this module is plain data and types.

import type { HostShell } from '@ekza-studio/editor/host';
import type { HaloStage, OperatorResult } from '@ekza-studio/editor-core';
import type { DestinationId } from '../path/destinations';
import type { Noun } from '../verbs/nouns';
import type { SheetId } from './types';

/**
 * The sections of the sheets T6b builds, in display order; `null` for the sheets of other packages (their sections are
 * theirs to declare when they land; until then any section name resolves, and the surface is pending anyway).
 */
export const SHEET_SECTIONS: Readonly<Record<SheetId, readonly string[] | null>> = {
  more: [],
  numbers: [
    'transform',
    'pivot',
    'shapeInputs',
    'mesh',
    'character',
    'channels',
    'limb',
    'foot',
    'joint',
    'camera',
    'imagePlane',
    'animation',
  ],
  scene: ['objects', 'characters', 'references', 'cameras', 'reparent', 'visibility'],
  view: ['look', 'show', 'panes', 'cameras', 'selection', 'manipulator', 'hideUi', 'fullScreen'],
  // Start in (the remembered entry) and the descriptor table's sections (`PREF_SECTIONS`); Advanced holds the rest.
  settings: [
    'startIn',
    'input',
    'keyboard',
    'display',
    'animation',
    'import',
    'advanced',
    'transform',
    'modeling',
    'rigging',
    'export',
    'undo',
    'autosave',
  ],
  health: ['legend', 'problems', 'checks'],
  help: ['gestures', 'glyphs', 'shortcuts', 'about', 'licences'],
  about: ['identity', 'licence', 'usage', 'flags', 'thumbnail'],
  // T7 (§10.6): search, kinds, the starter set, a file, the cards
  library: ['search', 'kinds', 'starterSet', 'fromFile', 'cards'],
  palette: null,
  makeEditableReport: null,
  checks: null,
  bones: null,
  weights: null,
  history: null,
  ask: null,
  share: null,
};

/** The sheets T6b builds (the lazy loaders in `sheetLoaders.ts`). */
export const T6B_SHEETS = ['more', 'numbers', 'scene', 'view', 'settings', 'health', 'help', 'about'] as const;
export type T6bSheetId = (typeof T6B_SHEETS)[number];

/** What a sheet is opened with (the frame passes it through unchanged). */
export interface SheetArgs {
  /** Scroll to and highlight a section (Health: a stage's rows; Help: shortcuts / about; Numbers: a section). */
  readonly section?: string;
  /** More: a filter typed ahead; Settings: a preference path to show. */
  readonly query?: string;
}

/** What the frame hands a sheet (§20.4 sketch; T6a builds the frame, the T6b harness stands in until then). */
export interface HaloSheetContext {
  readonly host: HostShell;
  readonly stage: HaloStage;
  /** The noun the sheet is about (More, Numbers), from the Halo or the breadcrumb; null: the empty space. */
  readonly noun: Noun | null;
  readonly destination: DestinationId;
  /** Where the frame docks sheets now (its size class, §4.6). */
  readonly side: 'right' | 'bottom';
  close(): void;
  open(sheet: SheetId, args?: SheetArgs): void;
  /** Switches the Path's stage (a More row from another stage says "switches to Rig" and does it, §8). */
  setStage(stage: HaloStage): void;
  setDestination(destination: DestinationId): void;
  /** Runs an operator for a sheet control: failures become toasts (`host.runFromUi`). */
  run(op: string, args?: unknown): Promise<OperatorResult<unknown>>;
  /** Opens the Pro layout (§16.1), e.g. the More sheet's footer *Open this in the Pro layout ▸*. */
  openPro(): void;
  /** Hide UI (§4.7): only the canvas and a faint restore button; absent where the frame has none. */
  hideUi?(): void;
}

export interface HaloSheetProps {
  readonly ctx: HaloSheetContext;
  readonly args?: SheetArgs;
}
