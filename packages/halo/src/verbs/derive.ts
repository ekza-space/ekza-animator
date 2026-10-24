// ⋯ More, derived (STUDIO-TOUCH-SPEC §6.3, §8; T6b): every operator the Disclosure Manifest attaches to a noun and
// stage — the noun's petals with their ▾ choices, then its More rows by group — each reading `plain · Pro name · hotkey`.
// Rows whose poll fails stay listed, greyed, with the reason inline and, when one operator removes the reason, its fix
// as one tap. Operators the menus call with different arguments get one row per argument value. A row with an option
// box carries ⚙ Options. Pure over the app (it polls, never runs); the More sheet renders it and search (T6a) reads
// `searchEntries` for its "Do" group, which lists every operator with an entry in every stage (§20.5 test 10).
import type { EditorApp, OperatorId, RunContext } from '@ekza-studio/editor-core';
import { DISCLOSURE } from '../manifest/disclosure';
import { PLAIN_LABELS } from '../manifest/labels';
import { paramSurfacesOf } from '../manifest/paramSurfaces';
import {
  type ArgValue,
  type Disclosure,
  entriesOf,
  isSurfaceEntry,
  type ManifestEntry,
  type NounKind,
  type Stage,
  STAGES,
  surfaceText,
} from '../manifest/types';
import { stagesOfWorkspaces } from '../path/destinations';
import type { Noun } from './nouns';
import { type PetalDef, petalsFor } from './table';

export interface MoreFix {
  readonly label: string;
  readonly op: OperatorId;
  readonly args?: unknown;
}

export interface MoreRow {
  /** Stable key: operator and arguments. */
  readonly key: string;
  readonly op: OperatorId;
  readonly args?: unknown;
  readonly plain: string;
  /** The Pro name (the registry label); empty when it reads the same as the plain label. */
  readonly pro: string;
  readonly hotkey: string | null;
  readonly enabled: boolean;
  readonly reason: string | null;
  readonly fix: MoreFix | null;
  /** ⚙ Options: the row's operator has an option box or a form (§6.3). */
  readonly options: boolean;
  /** Also a petal of this noun (the first layer). */
  readonly petal: boolean;
}

export interface MoreGroup {
  readonly title: string;
  readonly rows: readonly MoreRow[];
}

/** The context More polls with: the canvas, as a tap on the thing would run it. */
export const MORE_CONTEXT: RunContext = { panel: 'viewport', source: 'menu' };

const stableKey = (value: unknown): string => {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableKey(record[key])}`)
    .join(',')}}`;
};

/** The plain label of an operator: the manifest's own word, else the Pro name. */
export function plainLabel(app: EditorApp | null, op: string): string {
  return PLAIN_LABELS[op] ?? app?.operators.get(op)?.label ?? op;
}

/** The keyboard label of a binding that runs `op` with `args` (global bindings first), e.g. '⌘E'. */
export function hotkeyOf(app: EditorApp, op: string, args?: unknown): string | null {
  const key = stableKey(args);
  let best: { chord: Parameters<EditorApp['keymap']['label']>[0]; global: boolean } | null = null;
  for (const binding of app.keymap.bindings()) {
    if (binding.op !== op || stableKey(binding.args) !== key) continue;
    const global = binding.scope === 'global';
    if (best === null || (global && !best.global)) best = { chord: binding.chord, global };
  }
  return best === null ? null : app.keymap.label(best.chord);
}

/** One-tap fixes for common poll reasons (§6.3 "Needs a bound skin · Bind skin ▸"). */
const FIXES: readonly (readonly [RegExp, MoreFix])[] = [
  [/bound skin|not bound|bind (the )?skin first/i, { label: 'Bind skin', op: 'skin.bind' }],
  [/no skeleton|needs a skeleton|rig (it|the model) first/i, { label: 'Rig it for me', op: 'skel.quickRig.start' }],
  [/no (active )?(clip|animation)/i, { label: 'New animation', op: 'clip.new' }],
  [/component mode|select faces|face mode/i, { label: 'Edit shape', op: 'select.mode', args: { mode: 'face' } }],
];

export function fixFor(reason: string): MoreFix | null {
  return FIXES.find(([pattern]) => pattern.test(reason))?.[1] ?? null;
}

function poll(app: EditorApp, op: string, args: unknown): { enabled: boolean; reason: string | null } {
  if (app.operators.get(op) === undefined) return { enabled: false, reason: 'Not available here yet' };
  try {
    const result = app.operators.poll(op, MORE_CONTEXT, args);
    return result === true ? { enabled: true, reason: null } : { enabled: false, reason: result.reason };
  } catch (error) {
    return { enabled: false, reason: error instanceof Error ? error.message : 'Not available' };
  }
}

function row(app: EditorApp, op: OperatorId, args: unknown, plain: string, petal: boolean): MoreRow {
  const { enabled, reason } = poll(app, op, args);
  const pro = app.operators.get(op)?.label ?? '';
  return {
    key: `${op} ${stableKey(args)}`,
    op,
    ...(args === undefined ? {} : { args }),
    plain,
    pro: pro.toLowerCase() === plain.toLowerCase() ? '' : pro,
    hotkey: hotkeyOf(app, op, args),
    enabled,
    reason,
    fix: reason === null ? null : fixFor(reason),
    options: paramSurfacesOf(op).some((surface) => surface === 'options' || surface === 'form'),
    petal,
  };
}

/** The stages an entry is shown in (its own list, else the operator's workspaces, else all). */
export function stagesOfEntry(app: EditorApp | null, op: string, entry: Disclosure): readonly Stage[] {
  if ('stages' in entry && entry.stages !== undefined) return entry.stages;
  const workspaces = app?.operators.get(op)?.workspaces;
  if (workspaces === undefined) return STAGES;
  const stages = stagesOfWorkspaces(workspaces);
  return stages.length === 0 ? STAGES : stages;
}

/** Argument rows of a per-argument entry: one per literal combination of its predicate (single key lists expand). */
function argRows(entry: Disclosure): readonly Readonly<Record<string, ArgValue>>[] {
  const when = 'when' in entry ? entry.when : undefined;
  if (when === undefined) return [{}];
  let rows: Record<string, ArgValue>[] = [{}];
  for (const [key, allowed] of Object.entries(when)) {
    if (key.includes('.')) return [];
    const values = (Array.isArray(allowed) ? allowed : [allowed]) as ArgValue[];
    const literal = values.filter((value) => value !== '*' && value !== null);
    if (literal.length === 0) continue;
    rows = rows.flatMap((base) => literal.map((value) => ({ ...base, [key]: value })));
  }
  return rows;
}

const VALUE_WORDS: Readonly<Record<string, string>> = {
  move: 'Move ring',
  rotate: 'Turn ring',
  scale: 'Scale ring',
  multiCut: 'Multi-cut',
  insertLoop: 'Loop cut',
  slide: 'Slide',
  extrude: 'Pull',
};

function petalRows(app: EditorApp, petal: PetalDef): MoreRow[] {
  if (petal.op === undefined) return [];
  if (petal.menu !== undefined && petal.menu.length > 0) {
    return petal.menu.map((choice) => row(app, choice.op, choice.args, `${petal.plain}: ${choice.plain}`, true));
  }
  return [row(app, petal.op, petal.args, petal.plain, true)];
}

/** ⋯ More for a noun in a stage: its petals first, then its More rows by group (§6.3). */
export function moreGroups(
  app: EditorApp,
  noun: NounKind,
  stage: Stage,
  options: { readonly filter?: string; readonly manifest?: Readonly<Record<string, ManifestEntry>> } = {},
): readonly MoreGroup[] {
  const manifest = options.manifest ?? DISCLOSURE;
  const seen = new Set<string>();
  const groups = new Map<string, MoreRow[]>();
  const add = (title: string, item: MoreRow): void => {
    if (seen.has(item.key)) return;
    seen.add(item.key);
    const list = groups.get(title) ?? [];
    list.push(item);
    groups.set(title, list);
  };
  for (const petal of petalsFor(noun, stage)) for (const item of petalRows(app, petal)) add('On the Halo', item);
  for (const [op, value] of Object.entries(manifest)) {
    for (const entry of entriesOf(value)) {
      if (!isSurfaceEntry(entry)) continue;
      const more = entry.surfaces.find((surface) => 'more' in surface && surface.more === noun);
      if (more === undefined || !('more' in more)) continue;
      if (!stagesOfEntry(app, op, entry).includes(stage)) continue;
      const base = entry.plain ?? plainLabel(app, op);
      for (const args of argRows(entry)) {
        const values = Object.values(args);
        const single = values.map((value) => VALUE_WORDS[String(value)]).find((word) => word !== undefined);
        const plain = values.length === 0 || entry.plain === undefined ? base : (single ?? base);
        add(more.group, row(app, op as OperatorId, values.length === 0 ? undefined : args, plain, false));
      }
    }
  }
  const filter = (options.filter ?? '').trim().toLowerCase();
  const out: MoreGroup[] = [];
  for (const [title, rows] of groups) {
    const kept =
      filter === ''
        ? rows
        : rows.filter((item) => `${item.plain} ${item.pro} ${item.op}`.toLowerCase().includes(filter));
    if (kept.length > 0) out.push({ title, rows: kept });
  }
  return out;
}

/** More for a resolved noun (empty space when null). */
export function moreFor(app: EditorApp, noun: Noun | null, stage: Stage, filter?: string): readonly MoreGroup[] {
  return moreGroups(app, noun?.kind ?? 'empty', stage, filter === undefined ? {} : { filter });
}

/** One search result of the "Do" group (§8): every operator with a manifest entry, in every stage. */
export interface SearchEntry {
  readonly op: OperatorId;
  readonly args?: unknown;
  readonly plain: string;
  readonly pro: string;
  /** Where it lives without search ("on a face's Halo", "Numbers › Transform"); empty for search-only. */
  readonly where: string;
  /** The stages that show it: a result from another stage says "switches to …" and switches when run. */
  readonly stages: readonly Stage[];
  /** Opens in the Pro layout ▸ (a deliberate hand-off, §15.15). */
  readonly proOnly: boolean;
}

export function searchEntries(
  app: EditorApp | null,
  manifest: Readonly<Record<string, ManifestEntry>> = DISCLOSURE,
): readonly SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const [op, value] of Object.entries(manifest)) {
    for (const entry of entriesOf(value)) {
      if ('plumbing' in entry || 'wraps' in entry) continue;
      const plain = isSurfaceEntry(entry) ? (entry.plain ?? plainLabel(app, op)) : plainLabel(app, op);
      const pro = app?.operators.get(op)?.label ?? '';
      const where = isSurfaceEntry(entry) ? entry.surfaces.map(surfaceText).join(' · ') : '';
      const args = argRows(entry);
      const first = args.length === 1 && Object.keys(args[0] ?? {}).length > 0 ? args[0] : undefined;
      out.push({
        op: op as OperatorId,
        ...(first === undefined ? {} : { args: first }),
        plain,
        pro: pro.toLowerCase() === plain.toLowerCase() ? '' : pro,
        where,
        stages: 'proOnly' in entry ? STAGES : stagesOfEntry(app, op, entry),
        proOnly: 'proOnly' in entry,
      });
    }
  }
  return out;
}
