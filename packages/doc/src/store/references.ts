// References between built-in records (MVP-SPEC §4.2): which records point at which. Used to refuse hard deletes of
// referenced records (`Tx.remove`) and to keep undo/redo from orphaning another writer's records. The index covers
// every stored record (hidden and soft-deleted ones included), so a hidden dependant still blocks a hard delete.
import { compareStrings } from './diff';
import { type Row, rowKey } from './rows';

/** A reference from a record to another record: [referenced table, referenced id]. */
export type Reference = readonly [table: string, id: string];

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function push(out: Reference[], table: string, id: unknown): void {
  if (typeof id === 'string' && id.length > 0) out.push([table, id]);
}

/** Control references of a constraint: its driven control and its control-space targets. */
function constraintControls(row: Row, out: Reference[]): void {
  const driven = row['driven'];
  if (isObject(driven)) push(out, 'controls', driven['control']);
  const targets = row['targets'];
  if (!isObject(targets)) return;
  for (const slot of Object.values(targets)) {
    if (isObject(slot) && isObject(slot['target']) && slot['target']['kind'] === 'control') {
      push(out, 'controls', slot['target']['id']);
    }
  }
}

const NONE: readonly Reference[] = Object.freeze([]);

/** Outgoing references of a record of `table` (opaque and extension tables have none). */
export function referencesOf(table: string, row: Row): readonly Reference[] {
  const out: Reference[] = [];
  switch (table) {
    case 'characters':
      push(out, 'assets', row['asset']);
      push(out, 'rigs', row['rig']);
      break;
    case 'rigs':
      push(out, 'characters', row['character']);
      break;
    case 'controls':
      push(out, 'rigs', row['rig']);
      push(out, 'controls', row['parent']);
      push(out, 'controls', row['mirror']);
      break;
    case 'constraints':
      push(out, 'rigs', row['rig']);
      constraintControls(row, out);
      break;
    case 'solvers':
      push(out, 'rigs', row['rig']);
      break;
    case 'clips':
      push(out, 'characters', row['character']);
      if (isObject(row['source'])) push(out, 'assets', row['source']['asset']);
      break;
    case 'layers':
      push(out, 'clips', row['clip']);
      break;
    case 'curves':
      push(out, 'clips', row['clip']);
      push(out, 'layers', row['layer']);
      push(out, 'controls', row['control']);
      break;
    case 'keys':
      push(out, 'clips', row['clip']);
      push(out, 'curves', row['curve']);
      break;
    default:
      return NONE;
  }
  return out;
}

/** Fields that hold references, per table (a write that keeps them all identical keeps the references). */
const REFERENCE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  characters: ['asset', 'rig'],
  rigs: ['character'],
  controls: ['rig', 'parent', 'mirror'],
  constraints: ['rig', 'driven', 'targets'],
  solvers: ['rig'],
  clips: ['character', 'source'],
  layers: ['clip'],
  curves: ['clip', 'layer', 'control'],
  keys: ['clip', 'curve'],
};

/** Fast path of the index: true when a rewrite of a record cannot have changed its references. */
function sameReferenceFields(table: string, prev: Row, next: Row): boolean {
  // M-1: keys first and an indexed loop (no iterator per call: a drag frame rewrites 1,000 keys twice).
  if (table === 'keys') return prev['clip'] === next['clip'] && prev['curve'] === next['curve'];
  const fields = REFERENCE_FIELDS[table];
  if (fields === undefined) return true;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] as string;
    if (prev[field] !== next[field]) return false;
  }
  return true;
}

/** True when `row` (a record of `table`) references `target/id`. */
export function referencesRecord(table: string, row: Row, target: string, id: string): boolean {
  return referencesOf(table, row).some(([t, i]) => t === target && i === id);
}

/** Tables whose records other records can reference. */
const REFERENCED: ReadonlySet<string> = new Set([
  'assets',
  'characters',
  'rigs',
  'controls',
  'clips',
  'layers',
  'curves',
]);

/** Pending writes of an undo/redo step, by `rowKey`: the record it will hold (`undefined` = deleted). */
export type PlannedWrites = ReadonlyMap<string, { readonly table: string; readonly after: Row | undefined }>;

type Referrers = Map<string, Map<string, Reference>>;

function link(index: Referrers, target: string, referrer: string, reference: Reference): void {
  let set = index.get(target);
  if (set === undefined) {
    set = new Map();
    index.set(target, set);
  }
  set.set(referrer, reference);
}

/** Reverse index: referenced record → the records referencing it (as table/id pairs). */
export class ReferenceIndex {
  private readonly referrers: Referrers = new Map();
  /** Reverse references of the records a plan writes (built once per plan; plans only ever lose deletions). */
  private readonly planned = new WeakMap<PlannedWrites, Referrers>();

  /** Storage write hook. */
  onWrite(table: string, id: string, prev: Row | undefined, next: Row | undefined): void {
    if (prev !== undefined && next !== undefined && sameReferenceFields(table, prev, next)) return;
    const self = rowKey(table, id);
    if (prev !== undefined) {
      for (const [t, i] of referencesOf(table, prev)) {
        const key = rowKey(t, i);
        const set = this.referrers.get(key);
        if (set === undefined) continue;
        set.delete(self);
        if (set.size === 0) this.referrers.delete(key);
      }
    }
    if (next !== undefined) {
      for (const [t, i] of referencesOf(table, next)) link(this.referrers, rowKey(t, i), self, [table, id]);
    }
  }

  clear(): void {
    this.referrers.clear();
  }

  /**
   * The first record (as 'table/id', in code-unit order) other than the record itself that references `table/id`,
   * reading through `planned` writes when given: a referrer the plan deletes or rewrites without the reference does
   * not count, a record the plan writes with the reference does. `current` reads the stored record.
   */
  dependantOf(
    table: string,
    id: string,
    current: (table: string, id: string) => Row | undefined,
    planned?: PlannedWrites,
  ): string | null {
    if (!REFERENCED.has(table)) return null;
    const self = rowKey(table, id);
    const candidates = new Map<string, Reference>(this.referrers.get(self) ?? []);
    if (planned !== undefined) {
      for (const [key, reference] of this.plannedReferrers(planned).get(self) ?? []) candidates.set(key, reference);
    }
    let first: string | null = null;
    for (const [key, [t, i]] of candidates) {
      if (key === self) continue;
      const write = planned?.get(key);
      const record = write !== undefined ? write.after : current(t, i);
      if (record === undefined || !referencesRecord(t, record, table, id)) continue;
      const label = `${t}/${i}`;
      if (first === null || compareStrings(label, first) < 0) first = label;
    }
    return first;
  }

  private plannedReferrers(planned: PlannedWrites): Referrers {
    let index = this.planned.get(planned);
    if (index === undefined) {
      index = new Map();
      for (const [key, write] of planned) {
        if (write.after === undefined) continue;
        for (const [t, i] of referencesOf(write.table, write.after)) {
          link(index, rowKey(t, i), key, [write.table, write.after.id]);
        }
      }
      this.planned.set(planned, index);
    }
    return index;
  }
}
