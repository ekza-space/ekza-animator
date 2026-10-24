// The grammar's verb source (STUDIO-TOUCH-SPEC §6.1–§6.3, §20.2): which noun the selection is, its first-layer petals
// and its ⋯ More rows. Since the integration (T6-INT, P-T6A-1) the source is work package T6b's — the noun resolver
// (`verbs/nouns.ts`), the curated verb table with its in-place variants (`verbs/table.ts`) and More derived from the
// Disclosure Manifest (`verbs/derive.ts`) — behind the one seam the grammar was built on (`VerbSource`: `noun`,
// `petals`, `more`). This module adapts T6b's data to the grammar's shapes: the breadcrumb's crumbs, the petal's icon
// and action (an operator run, a stage switch, a sheet), ⟳ Again and Paste in place, and verb → target (§6.4).
import type { EditorApp, HaloStage, OperatorId, PollResult } from '@ekza-studio/editor-core';
import type { CompassSlot } from '@ekza-studio/ui/touch';
import { en } from '../i18n/en';
import { type NounKind, type SheetId, TARGET_OPS } from '../manifest/types';
import { PANE } from '../shell/stage';
import type { NounFocus } from '../shell/store';
import { characterNoun, EMPTY_NOUN, type Noun as KindNoun, resolveNoun as resolveKindNoun } from '../verbs/nouns';
import { PETAL_VARIANTS, type PetalDef, type PetalVariant, petalsFor } from '../verbs/table';
import type { VerbIcon } from './icons';

export type { NounKind };

/** One crumb of the breadcrumb (§6.5): tap it to select that ancestor, or to focus its noun (the character). */
export interface Crumb {
  readonly label: string;
  readonly select?: { readonly op: OperatorId; readonly args?: unknown };
  /** The crumb is a noun of its own (§6.2 "Character: the breadcrumb root"): a tap opens its Halo. */
  readonly focus?: NounFocus;
}

export interface Noun {
  readonly kind: NounKind;
  /** The lead record's id (the test API's `noun.id`), null for empty space and the manipulator. */
  readonly id: string | null;
  /** What the Halo's header and the screen reader say: "2 faces", "L Upper Arm", "3 parts". */
  readonly label: string;
  readonly count: number;
  readonly crumbs: readonly Crumb[];
  /** T6b's noun (the sheets' `HaloSheetContext.noun`, More's rows, Numbers' sections). */
  readonly source: KindNoun;
}

/** What a verb does: an operator run (with a form first when it has one, §5.6), a stage switch or a sheet. */
export type VerbAction =
  | { readonly op: OperatorId; readonly args?: unknown }
  | { readonly stage: HaloStage }
  | { readonly sheet: SheetId };

export interface Verb {
  /** Stable id (the operator id with its arguments, `stage:<stage>` or `sheet:<sheet>`). */
  readonly id: string;
  readonly label: string;
  readonly run: VerbAction;
  /** Pro's name, shown in More and read after the label (§6.3, P8). */
  readonly proName?: string;
  readonly icon?: VerbIcon;
  /** The long-press ring's compass slot (Pro's marking-menu direction where one exists, §6.1). */
  readonly slot?: CompassSlot;
  readonly hasMenu?: boolean;
  /** The verb changed in place (⟳ Again, Paste ▾, §6.1). */
  readonly changed?: boolean;
  /** §6.4: the verb needs a second thing — it waits for a tap on the target, then runs with the target as `parent`. */
  readonly target?: boolean;
}

export interface VerbSource {
  noun(app: EditorApp, stage: HaloStage, focus?: NounFocus | null): Noun | null;
  /** At most six, in slot order; the grammar greys the ones whose poll fails (§6.3). */
  petals(app: EditorApp, noun: Noun, stage: HaloStage): readonly Verb[];
  /**
   * ⋯ More beyond the petals: every other operator the Disclosure Manifest attaches to the noun and stage. Async: the
   * manifest is the More sheet's lazy chunk (§20.6), never in `/app`'s initial scripts.
   */
  more(app: EditorApp, noun: Noun, stage: HaloStage): Promise<readonly Verb[]>;
}

// ---------- nouns ----------

const recordName = (app: EditorApp, table: string, id: string): string | null =>
  (app.store.get(table as never, id as never) as { readonly name?: string } | undefined)?.name ?? null;

/** The character the Halo's breadcrumb starts at: the noun's own, else the active one (Rig), else the only one. */
function characterOf(app: EditorApp, noun: KindNoun): string | null {
  if (noun.character !== null) return noun.character;
  const characters = app.store.list('characters').filter((c) => c.deleted === null);
  const active = app.session.getState().activeCharacter;
  if (active !== null && characters.some((c) => c.id === active)) return active;
  return characters.length === 1 ? (characters[0]?.id ?? null) : null;
}

function crumbsOf(app: EditorApp, noun: KindNoun, stage: HaloStage): Crumb[] {
  const crumbs: Crumb[] = [];
  const character = noun.kind === 'mesh' && stage !== 'rig' ? null : characterOf(app, noun);
  if (character !== null && noun.kind !== 'character') {
    crumbs.push({
      label: recordName(app, 'characters', character) ?? en.halo.character,
      focus: { kind: 'character', id: character },
    });
  }
  const kind = noun.kind;
  if (kind === 'control' || kind === 'foot') {
    const record = app.store.get('controls', noun.id as never) as { readonly parent?: string | null } | undefined;
    if (noun.count === 1 && typeof record?.parent === 'string') {
      crumbs.push({
        label: recordName(app, 'controls', record.parent) ?? record.parent,
        select: { op: 'select.controls', args: { ids: [record.parent], mode: 'replace' } },
      });
    }
  } else if (kind === 'joint') {
    if (character === null) crumbs.push({ label: en.halo.skeleton });
  } else if (kind === 'faces' || kind === 'edges' || kind === 'vertices') {
    crumbs.push({ label: en.halo.scene });
    if (noun.id !== null) {
      crumbs.push({
        label: recordName(app, 'meshes', noun.id) ?? noun.id,
        select: { op: 'select.mode', args: { mode: 'object' } },
      });
    }
  } else if ((kind === 'mesh' || kind === 'imagePlane') && character === null) {
    crumbs.push({ label: en.halo.scene });
  }
  crumbs.push({ label: noun.label });
  return crumbs;
}

const MANIPULATOR: KindNoun = {
  kind: 'manipulator',
  id: null,
  ids: [],
  label: 'Manipulator',
  count: 0,
  character: null,
};

/** The noun the selection is in a stage (T6b's resolver), or a focused one (the character, the manipulator). */
export function resolveNoun(app: EditorApp, stage: HaloStage, focus: NounFocus | null = null): Noun | null {
  let source: KindNoun;
  if (
    focus?.kind === 'character' &&
    focus.id !== null &&
    app.store.get('characters', focus.id as never) !== undefined
  ) {
    source = characterNoun(app, focus.id);
  } else if (focus?.kind === 'manipulator') {
    source = MANIPULATOR;
  } else {
    source = resolveKindNoun(app, stage);
  }
  if (source.kind === 'empty') return null;
  return {
    kind: source.kind,
    id: source.id,
    label: source.label,
    count: source.count,
    crumbs: crumbsOf(app, source, stage),
    source,
  };
}

/** Empty space: the noun of a long-press on nothing (§6.2 first row; docked in the tray at rest). */
export function spaceNoun(): Noun {
  return { kind: 'empty', id: null, label: en.halo.emptySpace, count: 0, crumbs: [], source: EMPTY_NOUN };
}

// ---------- petals ----------

/** T6b's icon names (lucide's) → the Halo's own line icons (§6.1: the operators' `icon` stays untouched). */
const ICONS: Readonly<Record<string, VerbIcon>> = {
  box: 'shape',
  'person-standing': 'rig',
  image: 'upload',
  eye: 'eye',
  'eye-off': 'eye',
  palette: 'palette',
  'paint-bucket': 'paint',
  wand: 'rig',
  bone: 'rig',
  stethoscope: 'warn',
  link: 'bind',
  plus: 'clip',
  library: 'clip',
  diamond: 'key',
  'diamond-plus': 'key',
  scan: 'select',
  'scan-eye': 'select',
  'rotate-ccw': 'reset',
  'rotate-cw': 'orient',
  'square-dashed': 'faces',
  copy: 'copy',
  'flip-horizontal': 'mirror',
  brush: 'paint',
  paintbrush: 'paint',
  'arrow-up-from-square': 'pull',
  square: 'inset',
  'square-round-corner': 'bevel',
  trash: 'delete',
  scissors: 'cut',
  merge: 'merge',
  'move-horizontal': 'slide',
  spline: 'connect',
  crosshair: 'weld',
  clipboard: 'paste',
  repeat: 'again',
  compass: 'orient',
  pencil: 'pencil',
  search: 'search',
  play: 'play',
  'sliders-horizontal': 'options',
  'id-card': 'rig',
};

/** Per petal: the icon the Halo drew for it before the table (Duplicate is a copy with a plus). */
const PETAL_ICON: Readonly<Record<string, VerbIcon>> = { duplicate: 'duplicate', newAnimation: 'clip' };

export { TARGET_OPS };

const v = en.verbs;

function verbId(petal: PetalDef): string {
  if (petal.op !== undefined) return petal.args === undefined ? petal.op : `${petal.op}:${JSON.stringify(petal.args)}`;
  if (petal.go?.stage !== undefined) return `stage:${petal.go.stage}`;
  return `sheet:${petal.go?.sheet ?? petal.id}`;
}

function verbOf(petal: PetalDef, changed = false): Verb {
  const action: VerbAction | null =
    petal.op !== undefined
      ? petal.args === undefined
        ? { op: petal.op }
        : { op: petal.op, args: petal.args }
      : petal.go?.stage !== undefined
        ? { stage: petal.go.stage }
        : petal.go?.sheet !== undefined
          ? { sheet: petal.go.sheet }
          : null;
  const icon = PETAL_ICON[petal.id] ?? (petal.icon === undefined ? undefined : ICONS[petal.icon]);
  return {
    id: verbId(petal),
    label: petal.plain,
    run: action ?? { sheet: 'more' },
    ...(icon === undefined ? {} : { icon }),
    ...(petal.menu !== undefined && petal.menu.length > 1 ? { hasMenu: true } : {}),
    ...(changed ? { changed: true } : {}),
    ...(petal.target === true && petal.op !== undefined && TARGET_OPS.has(petal.op) ? { target: true } : {}),
  };
}

/** Does an in-place variant hold now (§6.1)? */
function variantHolds(app: EditorApp, variant: PetalVariant, petals: readonly PetalDef[]): boolean {
  const s = app.session.getState();
  switch (variant.when) {
    case 'repeatable': {
      const last = s.lastRun;
      return last !== null && last.repeatable && last.closed === null && petals.some((p) => p.op === last.id);
    }
    case 'poseCopied':
      return s.clipboard.pose !== null;
    case 'keysCopied':
      return s.clipboard.keys !== null;
    // the variant's own operator answers whether it applies (Unpin while feet are pinned, Make editable on an
    // imported character mesh, Bind again on a bound mesh)
    case 'feetPinned':
    case 'editableMesh':
    case 'bound':
      return variant.op !== undefined && pollOp(app, variant.op, variant.args) === true;
  }
}

function pollOp(app: EditorApp, op: OperatorId, args: unknown): PollResult {
  if (app.operators.get(op) === undefined) return { ok: false, reason: en.sheet.soon };
  try {
    return app.operators.poll(op, { panel: 'viewport', paneId: PANE }, args);
  } catch {
    return true;
  }
}

/** The petals of a noun in a stage: T6b's table with its in-place variants applied (slots never move, §6.1). */
export function petalVerbs(app: EditorApp, kind: NounKind, stage: HaloStage): Verb[] {
  const petals = petalsFor(kind, stage);
  const verbs = petals.map((petal) => verbOf(petal));
  for (const variant of PETAL_VARIANTS[kind] ?? []) {
    const index = petals.findIndex((p) => p.id === variant.replaces);
    if (index < 0 || !variantHolds(app, variant, petals)) continue;
    if (variant.when === 'repeatable') {
      // ⟳ Again names what it repeats (the last run's petal)
      const last = app.session.getState().lastRun;
      const repeated = petals.find((p) => p.op === last?.id)?.plain ?? last?.label ?? '';
      verbs[index] = { ...verbOf(variant, true), label: v.again(repeated) };
    } else {
      verbs[index] = verbOf(variant, true);
    }
  }
  // ids stay unique within a Halo (several petals may run one operator with their own fields, e.g. an image plane's)
  const seen = new Set<string>();
  return verbs.map((verb, i) => {
    if (!seen.has(verb.id)) {
      seen.add(verb.id);
      return verb;
    }
    const id = `${verb.id}#${petals[i]?.id ?? i}`;
    seen.add(id);
    return { ...verb, id };
  });
}

/** The verb source over T6b's nouns, verb table and derived More (the grammar's one seam). */
export const haloVerbs: VerbSource = {
  noun: resolveNoun,
  petals: (app, noun, stage) => petalVerbs(app, noun.kind, stage),
  async more(app, noun, stage) {
    const { moreFor } = await import('../verbs/derive');
    return moreFor(app, noun.source, stage)
      .flatMap((group) => group.rows)
      .filter((row) => !row.petal)
      .map(
        (row): Verb => ({
          id: row.key,
          label: row.plain,
          run: row.args === undefined ? { op: row.op } : { op: row.op, args: row.args },
          ...(row.pro === '' ? {} : { proName: row.pro }),
          ...(TARGET_OPS.has(row.op) ? { target: true } : {}),
        }),
      );
  },
};

/** The operator a verb runs, or null for a stage switch or a sheet. */
export function opOf(verb: Verb): OperatorId | null {
  return 'op' in verb.run ? verb.run.op : null;
}

/** A verb's poll in the single pane: true, or the reason it cannot run now (§6.3: greyed with the reason). */
export function pollVerb(app: EditorApp, verb: Verb): PollResult {
  if (!('op' in verb.run)) return true;
  // a verb → target cannot be polled before its target is tapped (§6.4); its run is
  if (verb.target === true)
    return app.operators.get(verb.run.op) === undefined ? { ok: false, reason: en.sheet.soon } : true;
  return pollOp(app, verb.run.op, verb.run.args);
}

/** Pro's name of a verb's operator (More, the accessible name). */
export function proNameOf(app: EditorApp, verb: Verb): string | undefined {
  const id = opOf(verb);
  if (id === null) return undefined;
  const label = app.operators.get(id)?.label;
  return label === undefined || label === verb.label ? undefined : label;
}
