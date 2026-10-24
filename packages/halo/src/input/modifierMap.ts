// The Thumb key's meanings (STUDIO-TOUCH-SPEC §5.5, ST-9): one data table keyed by the active tool, its phase and the
// gesture class. Each row says what the next tap and the next drag mean here, what the chooser (slide up) offers, and
// which virtual modifiers carry each meaning to the tools — Shift / Mod / Alt, the held keys the tools read (X V J D B
// M N I) and the stand-in middle button — exactly as Studio Pro's tools read the keyboard (`keymap/toolModifiers.ts`,
// the select tool's `selectModeOf`: Shift+Mod adds, Shift toggles, Mod removes). The first row that matches wins; no
// row: the key is hidden (it would change nothing). Coach text comes from the same row (§17).
import type { HaloStage, RigMode, ToolId } from '@ekza-studio/editor-core';
import { VIEWPORT_TOOL } from '@ekza-studio/editor-core';
import type { VirtualHoldCode, VirtualModifiers } from '@ekza-studio/viewport';
import { en } from '../i18n/en';

/** What the next tap or drag would act on (read from the session and the shell). */
export interface ThumbSituation {
  readonly stage: HaloStage;
  readonly tool: ToolId;
  readonly selected: boolean;
  readonly rigMode: RigMode;
  readonly jointSelected: boolean;
  readonly softSelect: boolean;
  readonly extrude: boolean;
  /** An open sheet (the Share sheet hides the key) or a recipe card waiting. */
  readonly sheet: string | null;
}

export interface Mods {
  readonly shift?: boolean;
  readonly mod?: boolean;
  readonly alt?: boolean;
  readonly held?: readonly VirtualHoldCode[];
  readonly button?: 0 | 1 | 2;
}

export interface Meaning {
  readonly id: string;
  /** One glyph per meaning: shape, not colour (§18). */
  readonly glyph: string;
  readonly label: string;
  /** Pro's equivalent, in grey in the chooser. */
  readonly proName: string;
  readonly mods: Mods;
  /** In the chooser: which line the meaning takes when chosen (selection meanings act on taps). */
  readonly gesture?: 'tap' | 'drag';
}

export interface ThumbRow {
  readonly id: string;
  matches(s: ThumbSituation): boolean;
  readonly tap?: Meaning;
  readonly drag?: Meaning;
  readonly choices: readonly Meaning[];
}

const t = en.thumb;

const SELECT_MORE: Meaning = {
  id: 'selectMore',
  glyph: '⊕',
  label: t.selectMore,
  proName: 'Shift + Mod click',
  mods: { shift: true, mod: true },
};
const PICK: Meaning = {
  id: 'pick',
  glyph: '⊙',
  label: t.pickOrUnpick,
  proName: 'Shift click',
  mods: { shift: true },
  gesture: 'tap',
};
const UNSELECT: Meaning = {
  id: 'unselect',
  glyph: '⊖',
  label: t.unselect,
  proName: 'Mod click',
  mods: { mod: true },
  gesture: 'tap',
};
const FINE: Meaning = { id: 'fine', glyph: '≈', label: t.fine, proName: 'Shift during a drag', mods: { shift: true } };
const COARSE: Meaning = {
  id: 'coarse',
  glyph: '×',
  label: t.coarse,
  proName: 'Mod during a drag',
  mods: { mod: true },
};

const MODEL_TRANSFORM: ReadonlySet<ToolId> = new Set([VIEWPORT_TOOL.move, VIEWPORT_TOOL.rotate, VIEWPORT_TOOL.scale]);

/** The table, first match wins (§5.5's rows in order of specificity). */
export const MODIFIER_MAP: readonly ThumbRow[] = [
  {
    id: 'hidden.sheet',
    matches: (s) => s.sheet === 'share',
    choices: [],
  },
  {
    id: 'multiCut',
    matches: (s) => s.tool === VIEWPORT_TOOL.multiCut,
    tap: { id: 'snapPoint', glyph: '⌖', label: t.snapPoint, proName: 'Shift click', mods: { shift: true } },
    choices: [{ id: 'loop', glyph: '⟂', label: t.loop, proName: 'Ctrl click', mods: { mod: true }, gesture: 'tap' }],
  },
  {
    id: 'paintColour',
    matches: (s) => s.tool === VIEWPORT_TOOL.paint,
    tap: { id: 'fillPart', glyph: '◉', label: t.fillPart, proName: 'Shift click', mods: { shift: true } },
    choices: [
      {
        id: 'pickColour',
        glyph: '⦿',
        label: t.pickColour,
        proName: 'held I',
        mods: { held: ['KeyI'] },
        gesture: 'tap',
      },
    ],
  },
  {
    id: 'paintWeights',
    matches: (s) => s.tool === VIEWPORT_TOOL.paintSkinWeights,
    tap: { id: 'sampleValue', glyph: '⦿', label: t.sampleValue, proName: 'held I', mods: { held: ['KeyI'] } },
    drag: { id: 'brushSize', glyph: '◎', label: t.brushSize, proName: 'held B + drag', mods: { held: ['KeyB'] } },
    choices: [
      {
        id: 'pickBone',
        glyph: '⊙',
        label: t.pickBone,
        proName: 'Shift + I click',
        mods: { shift: true, held: ['KeyI'] },
        gesture: 'tap',
      },
      { id: 'strength', glyph: '◐', label: t.strength, proName: 'held M + drag', mods: { held: ['KeyM'] } },
      { id: 'value', glyph: '▤', label: t.value, proName: 'held N + drag', mods: { held: ['KeyN'] } },
    ],
  },
  {
    id: 'joint',
    matches: (s) => s.stage === 'rig' && s.rigMode === 'skeleton' && s.jointSelected,
    tap: SELECT_MORE,
    drag: { id: 'alone', glyph: '◌', label: t.alone, proName: 'held D', mods: { held: ['KeyD'] } },
    choices: [
      { id: 'orientOnly', glyph: '⟲', label: t.orientOnly, proName: 'held D (rotate)', mods: { held: ['KeyD'] } },
      FINE,
    ],
  },
  {
    id: 'extrudeCap',
    matches: (s) => s.extrude,
    tap: SELECT_MORE,
    drag: { id: 'smart', glyph: '✦', label: t.smart, proName: 'Shift at drag start', mods: { shift: true } },
    choices: [FINE],
  },
  {
    id: 'falloff',
    matches: (s) => s.softSelect && s.selected && (s.stage === 'make' || s.stage === 'paint'),
    tap: SELECT_MORE,
    drag: { id: 'falloffSize', glyph: '◍', label: t.falloffSize, proName: 'held B + drag', mods: { held: ['KeyB'] } },
    choices: [PICK, UNSELECT],
  },
  {
    id: 'makeTransform',
    matches: (s) => s.selected && s.stage === 'make' && MODEL_TRANSFORM.has(s.tool),
    tap: SELECT_MORE,
    drag: { id: 'snap', glyph: '⌗', label: t.snap, proName: 'held X', mods: { held: ['KeyX'] } },
    choices: [
      FINE,
      COARSE,
      { id: 'pivotEdit', glyph: '⊹', label: t.pivotEdit, proName: 'held D', mods: { held: ['KeyD'] } },
    ],
  },
  {
    id: 'animateSelected',
    matches: (s) => s.selected && s.stage === 'animate',
    tap: SELECT_MORE,
    drag: FINE,
    choices: [PICK, UNSELECT, COARSE],
  },
  {
    id: 'selected',
    matches: (s) => s.selected,
    tap: SELECT_MORE,
    choices: [PICK, UNSELECT],
  },
];

/** The row in force, or null: the key is hidden. */
export function thumbRow(s: ThumbSituation): ThumbRow | null {
  const row = MODIFIER_MAP.find((r) => r.matches(s)) ?? null;
  return row === null || (row.tap === undefined && row.drag === undefined) ? null : row;
}

const NO_HELD: ReadonlySet<VirtualHoldCode> = new Set();

/** A meaning's virtual modifiers (nothing when no meaning applies). */
export function modsOf(meaning: Meaning | undefined): VirtualModifiers {
  const m = meaning?.mods ?? {};
  return {
    shift: m.shift === true,
    mod: m.mod === true,
    alt: m.alt === true,
    held: m.held === undefined ? NO_HELD : new Set(m.held),
    ...(m.button === undefined ? {} : { button: m.button }),
  };
}

/** The coach line of a row (§17: it always matches the label). */
export function coachText(row: ThumbRow): string {
  if (row.tap !== undefined) return t.coachTap(row.tap.label);
  return row.drag === undefined ? '' : t.coachDrag(row.drag.label);
}
