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

/** M6a `MeshOwner`: the character it names. */
function ownerCharacter(row: Row, out: Reference[]): void {
  const owner = row['owner'];
  if (isObject(owner)) push(out, 'characters', owner['character']);
}

/** A mesh's or group's parent: a GroupId (`grp_…`) or a MeshId (`msh_…`); other ids are checked in both tables. */
function hierarchyParent(row: Row, out: Reference[], meshParents: boolean): void {
  const parent = row['parent'];
  if (typeof parent !== 'string' || parent.length === 0) return;
  if (parent.startsWith('grp_') || !meshParents) push(out, 'groups', parent);
  else if (parent.startsWith('msh_')) push(out, 'meshes', parent);
  else {
    push(out, 'groups', parent);
    push(out, 'meshes', parent);
  }
}

/** Every record a mesh references (M6A-SPEC §4.2 `referencesOf` column). */
function meshReferences(row: Row, out: Reference[]): void {
  ownerCharacter(row, out);
  hierarchyParent(row, out, true);
  const source = row['source'];
  if (isObject(source)) push(out, 'assets', source['asset']);
  const material = row['material'];
  if (isObject(material) && Array.isArray(material['assetSlots'])) {
    for (const slot of material['assetSlots'] as readonly unknown[])
      if (isObject(slot)) push(out, 'assets', slot['asset']);
  }
  const skin = row['skin'];
  if (isObject(skin)) {
    push(out, 'assets', skin['asset']);
    push(out, 'skeletons', skin['skeleton']);
  }
  push(out, 'palettes', row['palette']);
  const data = row['data'];
  if (isObject(data) && Array.isArray(data['joints'])) {
    for (const joint of data['joints'] as readonly unknown[]) push(out, 'joints', joint);
  }
}

/** Outgoing references of a record of `table` (opaque and extension tables have none). */
export function referencesOf(table: string, row: Row): readonly Reference[] {
  const out: Reference[] = [];
  switch (table) {
    case 'characters': {
      // v3: the asset only when non-null (a model-sourced character has none); the skeleton of a model source.
      push(out, 'assets', row['asset']);
      push(out, 'rigs', row['rig']);
      const source = row['source'];
      if (isObject(source)) push(out, 'skeletons', source['skeleton']);
      break;
    }
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
    // M6a (M6A-SPEC §4.2)
    case 'meshes':
      meshReferences(row, out);
      break;
    case 'groups':
      ownerCharacter(row, out);
      hierarchyParent(row, out, false);
      break;
    case 'swatches':
      push(out, 'palettes', row['palette']);
      break;
    case 'imagePlanes':
      push(out, 'assets', row['asset']);
      break;
    case 'skeletons':
      push(out, 'characters', row['character']);
      break;
    case 'joints':
      push(out, 'skeletons', row['skeleton']);
      push(out, 'joints', row['parent']);
      push(out, 'joints', row['mirror']);
      break;
    default:
      return NONE;
  }
  return out;
}

/** Fields that hold references, per table (a write that keeps them all identical keeps the references). */
const REFERENCE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  characters: ['asset', 'rig', 'source'],
  rigs: ['character'],
  controls: ['rig', 'parent', 'mirror'],
  constraints: ['rig', 'driven', 'targets'],
  solvers: ['rig'],
  clips: ['character', 'source'],
  layers: ['clip'],
  curves: ['clip', 'layer', 'control'],
  keys: ['clip', 'curve'],
  meshes: ['owner', 'parent', 'source', 'material', 'skin', 'palette', 'data'],
  groups: ['owner', 'parent'],
  swatches: ['palette'],
  imagePlanes: ['asset'],
  skeletons: ['character'],
  joints: ['skeleton', 'parent', 'mirror'],
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
  'meshes',
  'groups',
  'palettes',
  'skeletons',
  'joints',
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
