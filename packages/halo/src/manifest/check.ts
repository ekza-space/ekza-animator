// The parity check (STUDIO-TOUCH-SPEC §20.5 tests 1–8, 10; AS-ST-2, ST-29; T6b): the Disclosure Manifest against a
// live census of every mount (`census.ts`), the call-site pairs of the static scan (`tooling/halo-callsites.mjs`),
// the `UiDialog` map and the curated verb table. Pure: the browser spec (`ha-parity`) runs it in the page over the
// joined census, the unit tests over a headless census. Test 9 (the parameter surfaces) is `tooling/param-lint.mjs`
// over `paramSurfaces.ts`.
import type { OperatorId, UiDialog } from '@ekza-studio/editor-core';
import { stagesOfWorkspaces } from '../path/destinations';
import { PETAL_OPS } from '../verbs/table';
import type { Census, CensusOperator, CensusPair } from './census';
import { DIALOG_SURFACES } from './dialogs';
import { DISCLOSURE } from './disclosure';
import { PLUMBING_ALLOWLIST } from './plumbing';
import { PRO_CHROME_OPERATORS } from './proOnly';
import { SHEET_SECTIONS } from './sheets';
import {
  type ArgPredicate,
  type ArgValue,
  BUILT_OWNERS,
  type Disclosure,
  entriesOf,
  isSurfaceEntry,
  type ManifestEntry,
  type NounKind,
  type Owner,
  ownerOf,
  STAGES,
  type Stage,
  type SurfaceDisclosure,
  type SurfaceRef,
  surfaceBuilt,
  surfaceText,
} from './types';

/** A pair of the static call-site scan: `args` is null (no arguments), `'*'` (not a literal) or a shape. */
export interface CallSitePair {
  readonly op: string;
  readonly args: unknown;
  readonly sites: readonly string[];
  /** A template-literal operator id (`mesh.create.*`). */
  readonly pattern?: boolean;
}

export type SearchOnlyKind = 'explicit' | 'pending';

/** One entry the `searchOnly` ratchet counts: an explicit `searchOnly`, or an entry whose surfaces are all pending. */
export interface SearchOnlyItem {
  readonly op: string;
  readonly when?: ArgPredicate;
  readonly kind: SearchOnlyKind;
  readonly stages: readonly Stage[] | 'all';
  /** The packages whose surfaces would make it reachable without search (pending only). */
  readonly owners: readonly Owner[];
  readonly reason: string;
}

export interface ParityReport {
  readonly violations: readonly string[];
  /** Live, non-stub operators of the census. */
  readonly live: number;
  readonly deferred: readonly string[];
  /** Live operators by how the manifest discloses them (an operator with several entries counts once, by its first). */
  readonly byKind: Readonly<Record<'surfaces' | 'proOnly' | 'plumbing' | 'wraps' | 'searchOnly', number>>;
  /** Operators with at least one built, non-search surface (directly or through their wrapper). */
  readonly reachable: number;
  readonly searchOnly: {
    readonly total: number;
    readonly byStage: Readonly<Record<Stage | 'all', number>>;
    readonly explicit: number;
    readonly pending: number;
    /** The count once each package's surfaces land (alone, on top of the built ones): its exit target. */
    readonly targets: Readonly<Partial<Record<Owner, number>>>;
    readonly items: readonly SearchOnlyItem[];
  };
  readonly pairs: { readonly checked: number; readonly dynamic: number; readonly sources: Record<string, number> };
}

export interface ParityInput {
  readonly census: Census;
  readonly callSites?: readonly CallSitePair[];
  readonly manifest?: Readonly<Record<string, ManifestEntry>>;
  readonly petals?: Readonly<Record<NounKind, ReadonlySet<string>>>;
  readonly sections?: Readonly<Record<string, readonly string[] | null>>;
  readonly plumbing?: Readonly<Record<string, string>>;
  readonly proChrome?: ReadonlySet<string>;
  readonly dialogs?: Readonly<Record<string, unknown>>;
  readonly built?: ReadonlySet<Owner>;
}

const PLAN_ORDER: readonly Owner[] = ['T6a', 'T6b', 'T7', 'T8', 'T9', 'T10', 'T11'];

// ---------- argument predicates ----------

const asList = (value: ArgValue | readonly ArgValue[]): readonly ArgValue[] =>
  Array.isArray(value) ? (value as readonly ArgValue[]) : [value as ArgValue];

export type ArgMatch = 'yes' | 'no' | 'dynamic';

/**
 * The value at a key of the arguments; a dotted key reads into nested objects (`patch.jointAxes`). Missing reads as
 * null; a `'*'` on the way (a value the scan could not read, or a spread `'...'` next to a missing key) reads as `'*'`.
 */
function valueAt(args: unknown, key: string): unknown {
  let value: unknown = args;
  for (const part of key.split('.')) {
    if (value === '*') return '*';
    if (value === null || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (!(part in record)) return '...' in record ? '*' : null;
    value = record[part];
  }
  return value ?? null;
}

/**
 * Does an argument value (a real value or a scan shape) satisfy a predicate? Every key of `when` must hold a listed
 * literal; a missing key reads as `null`. A `'*'` from the scan (not a literal) or a nested object cannot be decided:
 * 'dynamic' (it then matches, and the report counts it). No predicate matches everything.
 */
export function matchArgs(args: unknown, when: ArgPredicate | undefined): ArgMatch {
  if (when === undefined) return 'yes';
  if (args === '*') return 'dynamic';
  let dynamic = false;
  for (const [key, allowed] of Object.entries(when)) {
    const value = valueAt(args, key);
    const list = asList(allowed);
    if (value === '*' || (value !== null && typeof value === 'object')) {
      if (list.includes('*')) continue;
      dynamic = true;
      continue;
    }
    if (!list.includes(value as ArgValue)) return 'no';
  }
  return dynamic ? 'dynamic' : 'yes';
}

/** Two predicates are disjoint when some key they share allows no common literal. */
export function disjoint(a: ArgPredicate | undefined, b: ArgPredicate | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  for (const key of Object.keys(a)) {
    const other = b[key];
    if (other === undefined) continue;
    const left = asList(a[key] as ArgValue | readonly ArgValue[]);
    const right = asList(other);
    if (!left.some((value) => right.includes(value))) return true;
  }
  return false;
}

/** The entry of `op` that covers `args`: a matching predicate first, else the entry without one. */
export function entryFor(entries: readonly Disclosure[], args: unknown): { entry: Disclosure; match: ArgMatch } | null {
  let fallback: Disclosure | null = null;
  let dynamic: Disclosure | null = null;
  for (const entry of entries) {
    const when = 'when' in entry ? entry.when : undefined;
    if (when === undefined) {
      fallback ??= entry;
      continue;
    }
    const match = matchArgs(args, when);
    if (match === 'yes') return { entry, match };
    if (match === 'dynamic') dynamic ??= entry;
  }
  if (fallback !== null) return { entry: fallback, match: 'yes' };
  return dynamic === null ? null : { entry: dynamic, match: 'dynamic' };
}

// ---------- helpers ----------

function predicateText(when: ArgPredicate | undefined): string {
  return when === undefined ? '' : ` ${JSON.stringify(when)}`;
}

/** The stages an entry is shown in: its own list, else the operator's workspaces, else every stage. */
export function entryStages(entry: Disclosure, op: CensusOperator | undefined): readonly Stage[] | 'all' {
  if ('stages' in entry && entry.stages !== undefined) return entry.stages;
  const workspaces = op?.workspaces ?? null;
  if (workspaces === null) return 'all';
  const stages = stagesOfWorkspaces(workspaces);
  return stages.length === 0 || stages.length === STAGES.length ? 'all' : stages;
}

function liveSurfaces(entry: SurfaceDisclosure, built: ReadonlySet<Owner>): readonly SurfaceRef[] {
  return entry.surfaces.filter((surface) => surfaceBuilt(surface, built));
}

const STAGE_WORKSPACE: Readonly<Record<Stage, string>> = {
  make: 'model',
  paint: 'model',
  rig: 'rig',
  animate: 'animate',
};

// ---------- the check ----------

export function checkParity(input: ParityInput): ParityReport {
  const manifest = input.manifest ?? DISCLOSURE;
  const petals = input.petals ?? PETAL_OPS;
  const sections = input.sections ?? SHEET_SECTIONS;
  const plumbing = input.plumbing ?? PLUMBING_ALLOWLIST;
  const proChrome = input.proChrome ?? PRO_CHROME_OPERATORS;
  const dialogs = input.dialogs ?? DIALOG_SURFACES;
  const built = input.built ?? BUILT_OWNERS;
  const violations: string[] = [];
  const ops = new Map(input.census.operators.map((op) => [op.id, op]));
  const live = input.census.operators.filter((op) => !op.deferred);
  const liveIds = new Set(live.map((op) => op.id));

  // Test 1: every live operator has an entry, every entry names a live operator.
  for (const op of live) {
    if (manifest[op.id] === undefined) violations.push(`${op.id}: live operator without a manifest entry`);
  }
  for (const id of Object.keys(manifest)) {
    const op = ops.get(id);
    if (op === undefined) violations.push(`${id}: manifest entry names no operator of the census`);
    else if (op.deferred) violations.push(`${id}: manifest entry names a deferred stub (hidden in both shells)`);
  }

  // Shape of each operator's entries.
  for (const [id, value] of Object.entries(manifest)) {
    const entries = entriesOf(value);
    const op = ops.get(id);
    if (entries.length === 0) violations.push(`${id}: empty entry list`);
    if (entries.filter((entry) => !('when' in entry) || entry.when === undefined).length > 1) {
      violations.push(`${id}: more than one entry without a 'when' predicate`);
    }
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = entries[i] as Disclosure;
        const b = entries[j] as Disclosure;
        const wa = 'when' in a ? a.when : undefined;
        const wb = 'when' in b ? b.when : undefined;
        if (wa !== undefined && wb !== undefined && !disjoint(wa, wb)) {
          violations.push(`${id}: entries${predicateText(wa)} and${predicateText(wb)} overlap`);
        }
      }
    }
    for (const entry of entries) {
      if ('plumbing' in entry) {
        if (op !== undefined && !op.internal) violations.push(`${id}: 'plumbing' is for internal operators only`);
        if (plumbing[id] === undefined) violations.push(`${id}: 'plumbing' but not in PLUMBING_ALLOWLIST`);
      }
      if ('wraps' in entry) {
        if (op !== undefined && !op.internal) violations.push(`${id}: 'wraps' is for internal operators only`);
        const wrapper = manifest[entry.wraps];
        if (wrapper === undefined || !entriesOf(wrapper).some(isSurfaceEntry)) {
          violations.push(`${id}: wrapped by ${entry.wraps}, which has no surface entry`);
        }
        if (!liveIds.has(entry.wraps)) violations.push(`${id}: its wrapper ${entry.wraps} is not live`);
      }
      // Test 6: proOnly only from the listed reasons and operators.
      if ('proOnly' in entry && !proChrome.has(id)) {
        violations.push(`${id}: 'proOnly' outside the PRO_CHROME list (§20.5 test 6; add a reason to proOnly.ts)`);
      }
      if ('searchOnly' in entry && entry.searchOnly.trim() === '') violations.push(`${id}: searchOnly without reason`);
      if (!isSurfaceEntry(entry)) continue;
      if (entry.surfaces.length === 0) violations.push(`${id}: a surface entry with no surface`);
      // Test 7: every SurfaceRef resolves.
      for (const surface of entry.surfaces) {
        if ('petal' in surface && !(petals[surface.petal]?.has(id) ?? false)) {
          violations.push(`${id}: petal on '${surface.petal}' is not in the verb table (verbs/table.ts)`);
        }
        if ('more' in surface && surface.group.trim() === '') violations.push(`${id}: More row without a group`);
        if ('tray' in surface && op !== undefined && op.workspaces !== null) {
          if (!op.workspaces.includes(STAGE_WORKSPACE[surface.tray])) {
            violations.push(
              `${id}: in the ${surface.tray} tray but its workspaces exclude '${STAGE_WORKSPACE[surface.tray]}'`,
            );
          }
        }
        if ('sheet' in surface && surface.section !== undefined) {
          const known = sections[surface.sheet];
          if (known !== null && known !== undefined && !known.includes(surface.section)) {
            violations.push(`${id}: sheet section ${surface.sheet} › ${surface.section} does not exist`);
          }
        }
      }
    }
    // Test 8: a tool operator has a hands-on binding (a petal or a tray item that activates it).
    if (op !== undefined && op.tool !== null && !op.deferred) {
      const handsOn = entries.some(
        (entry) => isSurfaceEntry(entry) && entry.surfaces.some((surface) => 'petal' in surface || 'tray' in surface),
      );
      if (!handsOn) violations.push(`${id}: activates the '${op.tool}' tool but has no petal or tray binding`);
    }
  }

  // Tests 2–4: every (operator, arguments) pair Pro or Auto-Rig sends, every menu, marking-menu and key binding.
  const sources: Record<string, number> = {};
  let checked = 0;
  let dynamic = 0;
  const checkPair = (op: string, args: unknown, from: string): void => {
    const source = from.split(':')[0] ?? from;
    sources[source] = (sources[source] ?? 0) + 1;
    checked += 1;
    const known = ops.get(op);
    if (known === undefined) {
      violations.push(`${op}${predicateText(args as ArgPredicate)} (${from}): names no operator of the census`);
      return;
    }
    if (known.deferred) return;
    const value = manifest[op];
    if (value === undefined) return; // reported by test 1
    const found = entryFor(entriesOf(value), args);
    if (found === null) {
      violations.push(`${op} ${JSON.stringify(args)} (${from}): no entry covers these arguments`);
      return;
    }
    if (found.match === 'dynamic') dynamic += 1;
  };
  for (const pair of input.callSites ?? []) {
    if (pair.pattern === true) {
      const prefix = pair.op.replace(/\*.*$/, '');
      const matches = live.filter((op) => op.id.startsWith(prefix));
      if (matches.length === 0)
        violations.push(`${pair.op} (${pair.sites[0] ?? 'scan'}): the pattern names no operator`);
      for (const op of matches) checkPair(op.id, pair.args, `scan:${pair.sites[0] ?? ''}`);
      continue;
    }
    checkPair(pair.op, pair.args, `scan:${pair.sites[0] ?? ''}`);
  }
  for (const pair of input.census.menus) if (pair.args !== undefined) checkPair(pair.op, pair.args, pair.from);
  for (const pair of input.census.markingMenus) checkPair(pair.op, pair.args ?? null, pair.from);
  for (const pair of input.census.bindings) checkPair(pair.op, pair.args ?? null, pair.from);

  // Test 3: every UiDialog that `ui.open` is asked for has a Halo handler (the map's type covers the union).
  const askedDialogs = new Set<string>();
  const noteDialog = (pair: { readonly op: string; readonly args: unknown }): void => {
    if (pair.op !== 'ui.open' || pair.args === null || typeof pair.args !== 'object') return;
    const dialog = (pair.args as Record<string, unknown>)['dialog'];
    if (typeof dialog === 'string' && dialog !== '*') askedDialogs.add(dialog);
  };
  for (const pair of [...(input.callSites ?? []), ...input.census.menus, ...input.census.bindings]) noteDialog(pair);
  for (const dialog of askedDialogs) {
    if (dialogs[dialog as UiDialog] === undefined) violations.push(`ui.open {dialog: '${dialog}'}: no Halo handler`);
  }

  // Classification and the searchOnly ratchet (test 5).
  const byKind = { surfaces: 0, proOnly: 0, plumbing: 0, wraps: 0, searchOnly: 0 };
  let reachable = 0;
  const items: SearchOnlyItem[] = [];
  const reachableWith = (id: string, owners: ReadonlySet<Owner>, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    const value = manifest[id];
    if (value === undefined) return false;
    return entriesOf(value).some((entry) => {
      if (isSurfaceEntry(entry)) return liveSurfaces(entry, owners).length > 0;
      if ('wraps' in entry) return reachableWith(entry.wraps, owners, seen);
      return false;
    });
  };
  for (const op of live) {
    const value = manifest[op.id];
    if (value === undefined) continue;
    const entries = entriesOf(value);
    const first = entries[0] as Disclosure;
    const kind = isSurfaceEntry(first)
      ? 'surfaces'
      : 'proOnly' in first
        ? 'proOnly'
        : 'plumbing' in first
          ? 'plumbing'
          : 'wraps' in first
            ? 'wraps'
            : 'searchOnly';
    byKind[kind] += 1;
    if (reachableWith(op.id, built)) reachable += 1;
    for (const entry of entries) {
      if ('searchOnly' in entry) {
        items.push({
          op: op.id,
          ...(entry.when === undefined ? {} : { when: entry.when }),
          kind: 'explicit',
          stages: entryStages(entry, op),
          owners: [],
          reason: entry.searchOnly,
        });
        continue;
      }
      if (!isSurfaceEntry(entry) || liveSurfaces(entry, built).length > 0) continue;
      const owners = [...new Set(entry.surfaces.map(ownerOf))].sort(
        (a, b) => PLAN_ORDER.indexOf(a) - PLAN_ORDER.indexOf(b),
      );
      items.push({
        op: op.id,
        ...(entry.when === undefined ? {} : { when: entry.when }),
        kind: 'pending',
        stages: entryStages(entry, op),
        owners,
        reason: `pending: ${entry.surfaces.map(surfaceText).join(' · ')}`,
      });
    }
  }
  const byStage: Record<Stage | 'all', number> = { make: 0, paint: 0, rig: 0, animate: 0, all: 0 };
  for (const item of items) {
    if (item.stages === 'all') byStage.all += 1;
    else for (const stage of item.stages) byStage[stage] += 1;
  }
  const targets: Partial<Record<Owner, number>> = {};
  for (const owner of PLAN_ORDER) {
    if (built.has(owner)) continue;
    targets[owner] = items.filter((item) => item.kind === 'explicit' || !item.owners.includes(owner)).length;
  }

  return {
    violations,
    live: live.length,
    deferred: input.census.operators.filter((op) => op.deferred).map((op) => op.id),
    byKind,
    reachable,
    searchOnly: {
      total: items.length,
      byStage,
      explicit: items.filter((item) => item.kind === 'explicit').length,
      pending: items.filter((item) => item.kind === 'pending').length,
      targets,
      items,
    },
    pairs: { checked, dynamic, sources },
  };
}

/** Operator ids for which an entry exists (test 10: search lists each of them, in every stage). */
export function manifestIds(manifest: Readonly<Record<string, ManifestEntry>> = DISCLOSURE): readonly OperatorId[] {
  return Object.keys(manifest) as OperatorId[];
}

/** The census operators (for a quick look in reports). */
export type { CensusOperator, CensusPair };
