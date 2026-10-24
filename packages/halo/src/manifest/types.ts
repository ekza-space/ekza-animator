// The Disclosure Manifest's types (STUDIO-TOUCH-SPEC §20.5, ST-29; T6b). One entry per operator id — or several,
// split by argument — saying where Ekza Studio's Simple layout shows it: a Halo petal or a ⋯ More row on a noun, a
// stage's tray, a sheet section or a part of the frame (`SurfaceRef`); a reasoned Studio Pro hand-off (`proOnly`); an
// allow-listed internal operator (`plumbing`); search only (`searchOnly`, ratcheted); or an internal operator reached
// through a public wrapper (`wraps`). Data only: the registry itself is never changed (§20.5).
//
// Surfaces are owned by work packages (the frame by T6a, the sheets and More by T6b, the trays and the Thread by
// T7–T9, Share by T11, …). A surface whose owner has not landed yet is *pending*: an entry with only pending surfaces
// counts in the `searchOnly` ratchet until its owner lands, which gives each stage package its exit target (§21).
import type { HaloStage, OperatorId } from '@ekza-studio/editor-core';

export type Stage = HaloStage;
export const STAGES: readonly Stage[] = ['make', 'paint', 'rig', 'animate'];

/** The work packages that own surfaces (§21). */
export type Owner = 'T6a' | 'T6b' | 'T7' | 'T8' | 'T9' | 'T10' | 'T11';

/**
 * The owners whose surfaces exist on this branch. T6a (the frame, the Halo, chips, the session bar, the palette) and
 * T6b (manifest, verbs, the Path, the sheets) make phase S together (§21 phase exits); each stage package adds itself
 * when it lands, and the `searchOnly` baseline must then go down to its target.
 */
export const BUILT_OWNERS: ReadonlySet<Owner> = new Set<Owner>(['T6a', 'T6b']);

/** The nouns of §6.2: what a tap selects, each with a Halo (petals) and a ⋯ More list. */
export const NOUN_KINDS = [
  'empty',
  'mesh',
  'faces',
  'edges',
  'vertices',
  'imagePlane',
  'character',
  'control',
  'foot',
  'joint',
  'skinSpot',
  'keyDot',
  'band',
  'playhead',
  'curve',
  'channel',
  'clip',
  'libraryCard',
  'swatch',
  'healthDot',
  'historyStep',
  'camera',
  'manipulator',
  'rigDot',
] as const;
export type NounKind = (typeof NOUN_KINDS)[number];

/**
 * Who makes each noun reachable (§6.2 "how you get it"): a tap on the canvas (T6a's frame and canvas), a row of a T6b
 * sheet (Numbers' channel rows, Health's dots, the View sheet's cameras), the Thread (T7), the Paint tray (T8), Rig's
 * sessions (T9), Curves and History (T10).
 */
export const NOUN_OWNER: Readonly<Record<NounKind, Owner>> = {
  empty: 'T6a',
  mesh: 'T6a',
  faces: 'T6a',
  edges: 'T6a',
  vertices: 'T6a',
  // T6-INT: the canvas cannot select a plane (no selection operator holds its id, P-T6B-7), so its petals and More
  // wait for the Make stage (T8) to give planes a selection; the Scene sheet's rows reach its fields until then
  imagePlane: 'T8',
  character: 'T6a',
  control: 'T6a',
  foot: 'T6a',
  joint: 'T6a',
  manipulator: 'T6a',
  channel: 'T6b',
  healthDot: 'T6b',
  camera: 'T6b',
  keyDot: 'T7',
  band: 'T7',
  playhead: 'T7',
  clip: 'T7',
  libraryCard: 'T7',
  swatch: 'T8',
  skinSpot: 'T9',
  rigDot: 'T9',
  curve: 'T10',
  historyStep: 'T10',
};

/** The sheets of §4.1 and §20.2, and their owners (§21). */
export const SHEET_OWNER = {
  more: 'T6b',
  numbers: 'T6b',
  scene: 'T6b',
  view: 'T6b',
  settings: 'T6b',
  health: 'T6b',
  help: 'T6b',
  about: 'T6b',
  library: 'T7',
  palette: 'T8',
  /** Make editable's report (§6.7 `makeEditableReport`). */
  makeEditableReport: 'T8',
  checks: 'T9',
  bones: 'T9',
  weights: 'T9',
  history: 'T10',
  ask: 'T10',
  share: 'T11',
} as const satisfies Record<string, Owner>;
export type SheetId = keyof typeof SHEET_OWNER;

/** Parts of the frame (§4.1) and of the stages a surface may name, with their owners. */
export const CHROME_OWNER = {
  /** The Path's stage tabs (`workspace.set`) and readiness glyphs (T6b's `path/`). */
  path: 'T6b',
  /** `◂ Project • ▾`: New, Open, Import, Samples, Save project to Files, Recover, Scene, History, Settings, Help,
   *  Full screen, Home. */
  projectMenu: 'T6a',
  // No `search`: search is the safety net and never counts as a surface (§8, §20.5 test 5).
  proLayout: 'T6a',
  /** ↶, the undo toast with Redo. */
  undo: 'T6a',
  puck: 'T6a',
  thumb: 'T6a',
  sessionBar: 'T6a',
  breadcrumb: 'T6a',
  /** Make's *Select ▾* chip on the breadcrumb (Loop · Ring · Shell · Grow · Shrink · Select area). */
  selectChip: 'T6a',
  echoChips: 'T6a',
  /** The canvas gestures (tap, drag, double-tap, long-press). */
  canvas: 'T6a',
  /** The verb → target state (§6.4). */
  targetMode: 'T6a',
  /** The inline confirm cards of the kernel's questions (`rebindSkin`, `unbindSkin`, `applyPoseAsRest`; §6.7). */
  confirmCard: 'T6a',
  /** Status corner and the one Next chip (T6b's `path/nextChip.ts`). */
  statusCorner: 'T6b',
  home: 'T11',
  thread: 'T7',
  animationsRow: 'T7',
  rigCard: 'T9',
  dotsSession: 'T9',
  brushTray: 'T9',
  threadKeys: 'T7',
  threadCurves: 'T10',
  historyRibbon: 'T10',
} as const satisfies Record<string, Owner>;
export type ChromePart = keyof typeof CHROME_OWNER;

/**
 * The verbs that wait for a second thing through the frame's target mode (§6.4, ST-T6A-15): a petal or a More row
 * of one enters "now tap the target" and runs with `{ids: subject, parent: target}`. Its poll is not read before the
 * target is tapped (it asks for the target in the selection). Weld to… and Bridge are tool sessions instead.
 */
export const TARGET_OPS: ReadonlySet<string> = new Set<string>(['scene.parent']);

/** Stage trays (§7.1): owned by the stage packages. */
export const TRAY_OWNER: Readonly<Record<Stage, Owner>> = { make: 'T8', paint: 'T8', rig: 'T9', animate: 'T7' };

/** Where an operator is shown in the Simple layout. */
export type SurfaceRef =
  /** A Halo petal on the noun (curated in `verbs/table.ts`). */
  | { readonly petal: NounKind }
  /** A row of the noun's ⋯ More list, under a group heading. */
  | { readonly more: NounKind; readonly group: string }
  /** The stage's tray (the empty-space Halo, docked). */
  | { readonly tray: Stage }
  /** A sheet, optionally a named section of it. */
  | { readonly sheet: SheetId; readonly section?: string }
  /** A part of the frame, the Path or a stage's chrome. */
  | { readonly chrome: ChromePart };

/** An argument literal of a per-argument entry (`'*'` stands for a value the scan could not read). */
export type ArgValue = string | number | boolean | null;
/** Matches when every key's argument value is one of the listed literals (§20.5 per-argument entries). */
export type ArgPredicate = Readonly<Record<string, ArgValue | readonly ArgValue[]>>;

export type ProOnlyReason = 'PRO_CHROME' | 'KEYMAP' | 'MULTI_EDITOR';
/** Depth codes of §15: 0 on screen, 1 one tap on the thing, 2 a second step (More, a sheet section, a long-press). */
export type Depth = 0 | 1 | 2;

export type Disclosure =
  | {
      readonly surfaces: readonly SurfaceRef[];
      readonly depth: Depth;
      /** The stages that show it (default: from the operator's workspaces; none = every stage). */
      readonly stages?: readonly Stage[];
      /** The plain label of this entry when it differs from `labels.ts` (per-argument rows). */
      readonly plain?: string;
      readonly when?: ArgPredicate;
      /** Hands-on: the operator activates a tool or a session (§20.5 test 8); the surface activates it. */
      readonly handsOn?: true;
    }
  | { readonly proOnly: ProOnlyReason; readonly reason: string; readonly when?: ArgPredicate }
  | { readonly plumbing: string }
  | { readonly searchOnly: string; readonly when?: ArgPredicate; readonly stages?: readonly Stage[] }
  | { readonly wraps: OperatorId };

/** Several entries need disjoint `when` predicates; at most one may leave `when` out (the rest of the arguments). */
export type ManifestEntry = Disclosure | readonly Disclosure[];

export type SurfaceDisclosure = Extract<Disclosure, { readonly surfaces: readonly SurfaceRef[] }>;

export function isSurfaceEntry(entry: Disclosure): entry is SurfaceDisclosure {
  return 'surfaces' in entry;
}

/** The entries of a manifest value as a list. */
export function entriesOf(entry: ManifestEntry): readonly Disclosure[] {
  return Array.isArray(entry) ? (entry as readonly Disclosure[]) : [entry as Disclosure];
}

/** The owner of a surface. */
export function ownerOf(surface: SurfaceRef): Owner {
  if ('petal' in surface) return NOUN_OWNER[surface.petal];
  if ('more' in surface) return NOUN_OWNER[surface.more];
  if ('tray' in surface) return TRAY_OWNER[surface.tray];
  if ('sheet' in surface) return SHEET_OWNER[surface.sheet];
  return CHROME_OWNER[surface.chrome];
}

/** True when the surface exists on this branch (its owner has landed). */
export function surfaceBuilt(surface: SurfaceRef, built: ReadonlySet<Owner> = BUILT_OWNERS): boolean {
  return built.has(ownerOf(surface));
}

/** Readable form of a surface for reports and the More sheet's "where" line. */
export function surfaceText(surface: SurfaceRef): string {
  if ('petal' in surface) return `${surface.petal} Halo`;
  if ('more' in surface) return `${surface.more} ⋯ More › ${surface.group}`;
  if ('tray' in surface) return `${surface.tray} tray`;
  if ('sheet' in surface)
    return surface.section === undefined ? `${surface.sheet} sheet` : `${surface.sheet} › ${surface.section}`;
  return surface.chrome;
}
