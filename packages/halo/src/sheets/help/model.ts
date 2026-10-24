// The Help sheet's model (STUDIO-TOUCH-SPEC §17 "Help", §5.1, §5.2, §5.5, §5.8, §7.2, §1.1; T6b): React-free data for
// the gesture card (every gesture of §5.2 with what it does per input and its visible twin, the Thumb key, the
// routing modes), the readiness glyph legend, the shortcut sheet (Ekza Studio's own keys, then `app.keymap` grouped
// by scope with plain labels and Studio Pro's in grey), About and the licence notes. Help pages may name the parts
// (§1.3: Halo, Thread, Loupe, View puck, Echo chips).
import {
  EDITOR_VERSION,
  type EditorApp,
  GLOBAL_SCOPE,
  type KeyBinding,
  pickWalkDispatch,
  SAMPLES,
} from '@ekza-studio/editor-core';
import { entryFor } from '../../manifest/check';
import { DISCLOSURE } from '../../manifest/disclosure';
import { PLAIN_LABELS } from '../../manifest/labels';
import { entriesOf } from '../../manifest/types';
import { GLYPH_MEANING, GLYPH_TEXT, type StageGlyph } from '../../path/readiness';

// ---------- sections ----------

export type HelpSectionId = 'gestures' | 'glyphs' | 'shortcuts' | 'about' | 'licences';

export interface HelpSection {
  readonly id: HelpSectionId;
  readonly label: string;
}

/** The sheet's sections in display order (`SHEET_SECTIONS.help`; `ui.open` shortcuts / about scroll to theirs). */
const SECTIONS: readonly HelpSection[] = [
  { id: 'gestures', label: 'Gestures' },
  { id: 'glyphs', label: 'Stage marks' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  { id: 'about', label: 'About' },
  { id: 'licences', label: 'Licences' },
];

export function helpSections(): readonly HelpSection[] {
  return SECTIONS;
}

// ---------- gestures (§5.2, §5.5, §5.1) ----------

export interface GestureRow {
  readonly id: string;
  readonly gesture: string;
  readonly finger: string | null;
  readonly pencil: string | null;
  readonly mouse: string | null;
  /** The visible control that does the same (§18: every gesture has a button twin). */
  readonly twin: string;
}

const SAME = 'Same';

/** The gesture vocabulary of §5.2 (v1: the *Glue* row is after GA). */
const GESTURES: readonly GestureRow[] = [
  {
    id: 'tap',
    gesture: 'Tap a thing',
    finger: 'Selects it and opens its Halo',
    pencil: SAME,
    mouse: 'Click selects it',
    twin: 'Tap its row in the Scene sheet or in search',
  },
  {
    id: 'tapAgain',
    gesture: 'Tap a selected thing again',
    finger: 'Opens its Halo again',
    pencil: SAME,
    mouse: SAME,
    twin: '⋯ Verbs on the breadcrumb',
  },
  {
    id: 'overlap',
    gesture: 'Tap where things overlap',
    finger: 'The Loupe lists what is under your finger; Next › on the breadcrumb steps to the next one',
    pencil: SAME,
    mouse: SAME,
    twin: 'The Loupe list',
  },
  {
    id: 'tapEmpty',
    gesture: 'Tap empty space',
    finger: 'Clears the selection; in Animate a Reselect chip shows for 4 seconds',
    pencil: SAME,
    mouse: SAME,
    twin: '⋯ › Clear selection, or Reselect',
  },
  {
    id: 'drag',
    gesture: 'Drag a thing',
    finger: 'A selected thing or a handle: changes it. Anything else: orbits the view',
    pencil: 'Changes the thing, selected or not',
    mouse: 'Left-drag',
    twin: 'Echo chips and the numpad',
  },
  {
    id: 'dragEmpty',
    gesture: 'Drag empty space',
    finger: 'Orbits the view (pans a flat view); draws a selection box while Select more is on',
    pencil: 'Draws a selection box',
    mouse: 'Left-drag orbits',
    twin: 'Drag the View puck; Select ▾ › Select area',
  },
  {
    id: 'twoFinger',
    gesture: 'Two-finger drag or pinch',
    finger: 'Pans or zooms the view',
    pencil: null,
    mouse: 'Two-finger scroll and pinch',
    twin: 'Drag the View puck; its sheet › Zoom',
  },
  {
    id: 'twoFingerTap',
    gesture: 'Two-finger tap',
    finger: 'Undoes one step; the message names it and offers Redo',
    pencil: null,
    mouse: null,
    twin: '↶ Undo; Redo in the message and in History',
  },
  {
    id: 'doubleTap',
    gesture: 'Double-tap a thing or empty space',
    finger: 'Frames it, or frames everything',
    pencil: SAME,
    mouse: 'Double-click',
    twin: "The View puck's centre, or double-tap the puck",
  },
  {
    id: 'quickPinch',
    gesture: 'Quick pinch in',
    finger: 'Frames everything (Settings › Input can turn it off)',
    pencil: null,
    mouse: null,
    twin: 'Double-tap the View puck',
  },
  {
    id: 'longPress',
    gesture: 'Press and hold',
    finger: 'Opens the Halo as a ring where you hold; on a row, key, swatch, chip or channel, its menu',
    pencil: SAME,
    mouse: 'Right-click',
    twin: '⋯ on any Halo or chip',
  },
  {
    id: 'flick',
    gesture: 'Hold, slide toward a verb and let go',
    finger: 'Runs the verb you let go on',
    pencil: SAME,
    mouse: 'Right-drag',
    twin: 'Tap the verb',
  },
  {
    id: 'hover',
    gesture: 'Hover',
    finger: null,
    pencil: 'Highlights before you touch: the brush ring and value, the cut preview, faint labels of the Halo',
    mouse: 'Highlights and tooltips',
    twin: 'None needed: hovering only previews',
  },
  {
    id: 'pressure',
    gesture: 'Pencil pressure',
    finger: null,
    pencil: 'Brush strength (weights and colour)',
    mouse: null,
    twin: 'The Strength chip and the Pressure switch',
  },
  {
    id: 'thumbKey',
    gesture: 'The Thumb key',
    finger: 'Changes what your next tap or drag does (below)',
    pencil: null,
    mouse: 'Shift, ⌘ and Alt do the same',
    twin: 'The chip that shows what is on',
  },
  {
    id: 'thread',
    gesture: 'On the Thread (the timeline)',
    finger:
      'Tap the ruler: jump · drag the playhead: scrub · hold the ruler, then drag: select keys in a band · pinch sideways: zoom time · two-finger drag: pan time',
    pencil: 'Drag on the ruler: select keys in a band',
    mouse: 'Click, drag and the wheel',
    twin: 'The layer switch and the full transport',
  },
];

export function gestureRows(): readonly GestureRow[] {
  return GESTURES;
}

export interface ThumbRow {
  readonly id: string;
  readonly how: string;
  readonly what: string;
}

/** The Thumb key (§5.5): like the Shift key of the on-screen keyboard. */
export function thumbRows(): readonly ThumbRow[] {
  return [
    { id: 'tap', how: 'Tap', what: 'The meaning applies to your next action only, then turns off' },
    { id: 'doubleTap', how: 'Double-tap', what: 'Locks it on: the key shows a lock and a chip says what is on' },
    { id: 'hold', how: 'Hold', what: 'On for as long as your thumb stays down' },
    { id: 'slideUp', how: 'Slide up', what: 'Shows the other meanings that apply here' },
    { id: 'keyboard', how: 'A keyboard', what: 'Shift, ⌘ and Alt do the same; the key hides once you use one' },
  ];
}

export interface RoutingRow {
  readonly id: 'shared' | 'pencilEdits' | 'pencilOnly';
  readonly mode: string;
  readonly finger: string;
  readonly pencil: string;
  readonly when: string;
}

/** Who does what with a Pencil around (§5.1, Settings › Input). */
export function routingRows(): readonly RoutingRow[] {
  return [
    {
      id: 'shared',
      mode: 'Shared',
      finger:
        'A drag changes what is already selected, or a handle; anywhere else it orbits. Two fingers pan and pinch',
      pencil: 'Same as a finger, with finer aim',
      when: 'Until you first use a Pencil',
    },
    {
      id: 'pencilEdits',
      mode: 'Pencil edits',
      finger:
        'Moves the view, taps to select, holds for the Halo, scrubs the Thread and chips; never paints or drags shapes',
      pencil: 'Selects, changes anything you can see, paints, draws selection boxes and key bands, writes in fields',
      when: 'From your first Pencil touch, with a message to keep or change it',
    },
    {
      id: 'pencilOnly',
      mode: 'Pencil only',
      finger: 'Moves the view and taps buttons only',
      pencil: 'Everything on the canvas',
      when: 'When you choose it',
    },
  ];
}

// ---------- glyphs (§7.2) ----------

export interface GlyphRow {
  readonly glyph: StageGlyph;
  /** As drawn on a stage: `⚠n` shows a count. */
  readonly text: string;
  readonly meaning: string;
}

const GLYPH_ORDER: readonly StageGlyph[] = ['untouched', 'progress', 'ready', 'warn', 'unchecked'];

export function glyphRows(): readonly GlyphRow[] {
  return GLYPH_ORDER.map((glyph) => ({
    glyph,
    text: glyph === 'warn' ? `${GLYPH_TEXT[glyph]}n` : GLYPH_TEXT[glyph],
    meaning:
      glyph === 'warn'
        ? `n ${GLYPH_MEANING[glyph]}`
        : glyph === 'untouched'
          ? `${GLYPH_MEANING[glyph]} (Paint stays ${GLYPH_TEXT[glyph]} until a colour is set)`
          : glyph === 'unchecked'
            ? `${GLYPH_MEANING[glyph]}: that part of the studio has not loaded`
            : GLYPH_MEANING[glyph],
  }));
}

// ---------- shortcuts (§5.8, Studio Pro's shortcut sheet) ----------

export interface ShortcutRow {
  readonly key: string;
  /** The keys, in the platform's names (`⇧⌘S` / `Ctrl+Shift+S`), with tap / hold. */
  readonly keys: string;
  /** Plain words: the per-argument row's own label, else the operator's plain label, else its Studio Pro label. */
  readonly label: string;
  /** Studio Pro's label, with arguments the plain label does not name (grey); empty when the same. */
  readonly pro: string;
  /** False when the operator is not loaded on this page yet. */
  readonly available: boolean;
}

export interface ShortcutGroup {
  readonly scope: string;
  readonly label: string;
  /** Studio Pro's name for the scope (grey). */
  readonly pro: string | null;
  readonly rows: readonly ShortcutRow[];
}

/** Scopes in plain words, and Studio Pro's names where it has them. */
const SCOPE_WORDS: Readonly<Record<string, { readonly label: string; readonly pro?: string }>> = {
  [GLOBAL_SCOPE]: { label: 'Everywhere' },
  viewport: { label: 'In the view', pro: 'Viewport' },
  graph: { label: 'Curves', pro: 'Graph Editor' },
  timeline: { label: 'Thread', pro: 'Time slider' },
  outliner: { label: 'Scene', pro: 'Outliner' },
  channels: { label: 'Numbers', pro: 'Channels' },
  attributes: { label: 'Numbers, details', pro: 'Attributes' },
  clips: { label: 'Animations', pro: 'Clips' },
  dopeSheet: { label: 'Keys', pro: 'Dope Sheet' },
  model: { label: 'Make', pro: 'Model' },
  'model.viewport': { label: 'Make, in the view', pro: 'Model viewport' },
  'model.viewport.component': { label: 'Make, editing a shape', pro: 'Component modes' },
  'model.viewport.vertex': { label: 'Make, points', pro: 'Vertex mode' },
  'model.viewport.edge': { label: 'Make, edges', pro: 'Edge mode' },
  'model.viewport.face': { label: 'Make, faces', pro: 'Face mode' },
  'model.outliner': { label: 'Make, Scene', pro: 'Model Outliner' },
  rig: { label: 'Rig' },
  'rig.viewport': { label: 'Rig, in the view', pro: 'Rig viewport' },
  'rig.viewport.skeleton': { label: 'Rig, skeleton', pro: 'Skeleton' },
  'rig.viewport.skin': { label: 'Rig, weights', pro: 'Skin' },
  'rig.outliner': { label: 'Rig, Scene', pro: 'Rig Outliner' },
  'rig.channels': { label: 'Rig, Numbers', pro: 'Rig Channels' },
  'rig.timeline': { label: 'Rig, Thread', pro: 'Rig Time slider' },
  'rig.dopeSheet': { label: 'Rig, Keys', pro: 'Rig Dope Sheet' },
  'rig.graph': { label: 'Rig, Curves', pro: 'Rig Graph Editor' },
  'rig.paintWeights': { label: 'Rig, weight painting', pro: 'Paint Weights' },
};

function chordText(app: EditorApp, binding: KeyBinding): string {
  const label = app.keymap.label(binding.chord);
  if (binding.trigger === 'tap') return `${label} tap`;
  if (binding.trigger === 'hold') return `${label} hold`;
  return label;
}

/** Studio Pro's way of naming arguments: the scalar values in parentheses. */
function argsText(args: unknown): string {
  if (args === undefined || args === null || typeof args !== 'object') return '';
  const values = Object.values(args as Record<string, unknown>).filter(
    (value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
  );
  return values.length === 0 ? '' : ` (${values.join(', ')})`;
}

/** A per-argument manifest row's plain label for these arguments (`view.toggleMaximize {panel: null}` → …). */
export function argumentPlain(op: string, args: unknown): string | null {
  const entry = DISCLOSURE[op];
  if (entry === undefined || args === undefined) return null;
  const found = entryFor(entriesOf(entry), args);
  if (found === null || found.match !== 'yes') return null;
  const disclosure = found.entry;
  return 'surfaces' in disclosure && disclosure.when !== undefined && disclosure.plain !== undefined
    ? disclosure.plain
    : null;
}

function shortcutRow(app: EditorApp, binding: KeyBinding, index: number): ShortcutRow {
  // M2A-SPEC §5.17: the arrows run `select.pickWalk`, which steps frames with Settings › Keyboard › Arrow keys.
  const dispatched = binding.op === 'select.pickWalk' ? pickWalkDispatch(app, binding.args) : null;
  const op = dispatched?.op ?? binding.op;
  const args = dispatched === null ? binding.args : dispatched.args;
  const def = app.operators.get(op);
  const proLabel = def?.label ?? op;
  const perArgument = argumentPlain(op, args);
  const label = perArgument ?? PLAIN_LABELS[op] ?? proLabel;
  const pro = perArgument === null ? `${proLabel}${argsText(args)}` : proLabel;
  return {
    key: `${binding.scope}:${index}`,
    keys: chordText(app, binding),
    label,
    pro: pro === label ? '' : pro,
    available: def !== undefined,
  };
}

/** Studio Pro's key bindings grouped by scope, Everywhere first, each filtered by keys, words or scope. */
export function shortcutGroups(app: EditorApp, filter = ''): readonly ShortcutGroup[] {
  const needle = filter.trim().toLowerCase();
  const byScope = new Map<string, ShortcutRow[]>();
  app.keymap.bindings().forEach((binding, index) => {
    const row = shortcutRow(app, binding, index);
    const words = SCOPE_WORDS[binding.scope];
    const haystack = `${row.keys} ${row.label} ${row.pro} ${words?.label ?? binding.scope}`.toLowerCase();
    if (needle !== '' && !haystack.includes(needle)) return;
    const rows = byScope.get(binding.scope) ?? [];
    rows.push(row);
    byScope.set(binding.scope, rows);
  });
  const scopes = [...byScope.keys()].sort((a, b) =>
    a === GLOBAL_SCOPE ? -1 : b === GLOBAL_SCOPE ? 1 : a.localeCompare(b),
  );
  return scopes.map((scope) => {
    const words = SCOPE_WORDS[scope];
    return { scope, label: words?.label ?? scope, pro: words?.pro ?? null, rows: byScope.get(scope) ?? [] };
  });
}

export interface HaloKeyRow {
  readonly keys: string;
  readonly label: string;
}

/** Ekza Studio's own keys (§5.8), in the platform's key names; filtered like the shortcut groups. */
export function haloKeys(app: EditorApp, filter = ''): readonly HaloKeyRow[] {
  const label = (code: string, mods: { mod?: boolean; ctrl?: boolean } = {}): string =>
    app.keymap.label({ code, ...mods });
  const rows: HaloKeyRow[] = [
    { keys: label('Space'), label: 'Play and stop (Studio Pro keeps its own Space setting)' },
    { keys: `${label('KeyK', { mod: true })} or /`, label: 'Search' },
    { keys: `${label('Digit1', { ctrl: true })}–4`, label: 'Make, Paint, Rig, Animate' },
    { keys: label('Escape'), label: 'Cancel a tool session (✕)' },
    { keys: label('Enter'), label: 'Finish a tool session (✓ Done)' },
    { keys: label('KeyT'), label: 'Type into the first Echo chip' },
    { keys: label('KeyG'), label: 'Again' },
  ];
  const needle = filter.trim().toLowerCase();
  return needle === '' ? rows : rows.filter((row) => `${row.keys} ${row.label}`.toLowerCase().includes(needle));
}

// ---------- About and licences (§1.1, §17) ----------

/** Where the web app serves the third-party notices (`apps/web/scripts/third-party-notices.mjs` writes
 *  `public/THIRD_PARTY_NOTICES.txt`; Studio Pro's About links the same file). */
export const THIRD_PARTY_NOTICES_URL = '/THIRD_PARTY_NOTICES.txt';

export interface AboutInfo {
  readonly name: string;
  readonly version: string;
  /** The beta note (§17: About carries it). */
  readonly beta: string;
  /** §1.1's positioning line. */
  readonly positioning: string;
  readonly licence: string;
  readonly noticesHref: string;
}

export function aboutInfo(): AboutInfo {
  return {
    name: 'Ekza Studio',
    version: EDITOR_VERSION,
    beta: 'Simple layout — beta. Everything you make here opens in the Pro layout too.',
    positioning: 'One studio, two layouts. Simple: one thing at a time, by touch. Pro: every panel at once.',
    licence: 'MIT',
    noticesHref: THIRD_PARTY_NOTICES_URL,
  };
}

export interface LicenceRow {
  readonly id: string;
  readonly text: string;
}

/** The licence notes; the full texts and the attributions are in the third-party notices. */
export function licenceRows(): readonly LicenceRow[] {
  const samples = Object.values(SAMPLES).map(
    (sample): LicenceRow => ({
      id: `sample:${sample.id}`,
      text: `Sample: ${sample.license.title} by ${sample.license.author} (${sample.license.license.replace(/^LicenseRef-/, '')})`,
    }),
  );
  return [
    { id: 'code', text: "Ekza Studio's code is MIT licensed by the Ekza Studio contributors." },
    { id: 'curves', text: 'The curve evaluation port is Apache-2.0; its attribution is in the notices.' },
    { id: 'fonts', text: 'The fonts are under the SIL Open Font License 1.1.' },
    { id: 'clips', text: "The clip library's starter animations are CC0; their attributions are in the notices." },
    ...samples,
  ];
}
