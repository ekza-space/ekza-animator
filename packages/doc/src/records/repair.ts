// Repairs of document content (MVP-SPEC §3 rule 6 "repair, never reject"; M6A-SPEC §4.2 rules table). Writes are
// validated (`validateRecord` throws on problems a write introduces); loaded and received content is never rejected:
// `migrateSnapshot` runs these repairs, and readers may run `repairRecord` on what they read. Every repair is pure,
// deterministic and idempotent, and returns the very same object when nothing needs repair.
import {
  BUDGET_PRESETS,
  COLOUR_OUTPUTS,
  GROUP_TEMPLATES,
  HANDHELD_LIMITS,
  MESH_NAME_MAX,
  PRIMITIVE_KINDS,
  SKELETON_PRESETS,
} from './validate';

type Obj = Readonly<Record<string, unknown>>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export interface RepairResult {
  /** The repaired record (`===` the input when nothing was repaired). */
  readonly record: unknown;
  /** What was repaired, as 'field: what' sentences (empty when nothing was). */
  readonly problems: readonly string[];
}

const UNCHANGED = Object.freeze([]) as readonly string[];

/** Name repair of meshes and groups: a non-empty string of at most 64 characters. */
function repairName(value: unknown, fallback: string, problems: string[]): string {
  if (typeof value !== 'string' || value.length === 0) {
    problems.push(`name: empty or missing, set to '${fallback}'`);
    return fallback;
  }
  if (value.length > MESH_NAME_MAX) {
    problems.push(`name: longer than ${MESH_NAME_MAX} characters, shortened`);
    return value.slice(0, MESH_NAME_MAX);
  }
  return value;
}

function repairGrip(value: unknown, problems: string[]): unknown {
  if (!isObj(value)) return value;
  let changed = false;
  const axis = (v: unknown, limit: number): number => {
    const next = finite(v) ? clamp(v, -limit, limit) : 0;
    if (next !== v) changed = true;
    return next;
  };
  const triple = (v: unknown, limit: number): readonly [number, number, number] => {
    const items = Array.isArray(v) ? v : [];
    if (items.length !== 3) changed = true;
    return [axis(items[0], limit), axis(items[1], limit), axis(items[2], limit)];
  };
  const offset = triple(value['offset'], HANDHELD_LIMITS.offset);
  const rotationDegrees = triple(value['rotationDegrees'], HANDHELD_LIMITS.rotationDegrees);
  const rawScale = value['scale'];
  const scale = finite(rawScale) ? clamp(rawScale, HANDHELD_LIMITS.scaleMin, HANDHELD_LIMITS.scaleMax) : 1;
  if (scale !== rawScale) changed = true;
  if (!changed) return value;
  problems.push('handheld: grip values clamped into their bounds');
  return { ...value, offset, rotationDegrees, scale };
}

function repairMeshOrGroup(table: 'meshes' | 'groups', record: Obj, problems: string[]): Obj {
  const next: Record<string, unknown> = { ...record };
  next['name'] = repairName(record['name'], table === 'meshes' ? 'Mesh' : 'Group', problems);
  if (record['parent'] === record['id']) {
    problems.push('parent: the record was its own parent, set to null');
    next['parent'] = null;
  }
  if (table === 'meshes') {
    const generator = record['generator'];
    if (generator !== null && generator !== undefined) {
      if (!isObj(generator) || !(PRIMITIVE_KINDS as readonly unknown[]).includes(generator['kind'])) {
        problems.push('generator: unknown primitive kind, set to null');
        next['generator'] = null;
      }
    }
    if (!(COLOUR_OUTPUTS as readonly unknown[]).includes(record['colourOutput'])) {
      problems.push(`colourOutput: unknown value, set to 'palette-texture'`);
      next['colourOutput'] = 'palette-texture';
    }
  } else {
    const template = record['template'];
    if (template !== null && template !== undefined) {
      if (!isObj(template) || !(GROUP_TEMPLATES as readonly unknown[]).includes(template['kind'])) {
        problems.push('template: unknown kind, set to null');
        next['template'] = null;
      }
    }
  }
  const budget = record['budget'];
  if (isObj(budget) && 'preset' in budget && !(BUDGET_PRESETS as readonly unknown[]).includes(budget['preset'])) {
    problems.push('budget: unknown preset, set to null');
    next['budget'] = null;
  }
  next['handheld'] = repairGrip(record['handheld'], problems);
  return next;
}

/**
 * Per-record repairs of the M6A-SPEC §4.2 rules table (and the v3 fields of characters and assets). Unknown tables and
 * records that need no repair come back unchanged (`===`). Problems a repair cannot fix (a wrong type with no
 * documented repair) are left for readers: validation still lists them.
 */
export function repairRecord(table: string, record: unknown): RepairResult {
  if (!isObj(record)) return { record, problems: UNCHANGED };
  const problems: string[] = [];
  let next: Obj = record;
  switch (table) {
    case 'characters': {
      const source = record['source'];
      const asset = record['asset'];
      if (!isObj(source) && typeof asset === 'string' && asset.length > 0) {
        problems.push("source: missing, set to {kind: 'asset', asset}");
        next = { ...record, source: { kind: 'asset', asset } };
      }
      break;
    }
    case 'assets':
      if (!('provenance' in record)) {
        problems.push('provenance: missing, set to null');
        next = { ...record, provenance: null };
      }
      break;
    case 'meshes':
    case 'groups':
      next = repairMeshOrGroup(table, record, problems);
      break;
    case 'palettes':
      if (typeof record['name'] !== 'string' || record['name'].length === 0) {
        problems.push("name: empty or missing, set to 'Palette'");
        next = { ...record, name: 'Palette' };
      }
      break;
    case 'swatches': {
      const srgb = record['srgb'];
      const items: readonly unknown[] = Array.isArray(srgb) ? srgb : [];
      const fixed = [0, 1, 2].map((i) => {
        const v = items[i];
        return finite(v) ? clamp(Math.round(v), 0, 255) : 0;
      });
      if (items.length !== 3 || fixed.some((v, i) => v !== items[i])) {
        problems.push('srgb: clamped and rounded to three integers 0…255');
        next = { ...record, srgb: fixed };
      }
      break;
    }
    case 'imagePlanes': {
      const patch: Record<string, unknown> = {};
      const size = record['size'];
      if (!finite(size) || size <= 0) {
        problems.push('size: not a positive number, set to 2');
        patch['size'] = 2;
      }
      const opacity = record['opacity'];
      const clamped = finite(opacity) ? clamp(opacity, 0, 1) : 0.5;
      if (clamped !== opacity) {
        problems.push('opacity: clamped into 0…1');
        patch['opacity'] = clamped;
      }
      if (Object.keys(patch).length > 0) next = { ...record, ...patch };
      break;
    }
    case 'skeletons':
      if (!(SKELETON_PRESETS as readonly unknown[]).includes(record['preset'])) {
        problems.push("preset: unknown, set to 'custom'");
        next = { ...record, preset: 'custom' };
      }
      break;
    default:
      break;
  }
  return problems.length === 0 ? { record, problems: UNCHANGED } : { record: next, problems };
}

const isLive = (row: Obj): boolean => row['deleted'] === null || row['deleted'] === undefined;
const ownerKey = (row: Obj): string => {
  const owner = row['owner'];
  if (isObj(owner) && typeof owner['character'] === 'string') return `char:${owner['character']}`;
  return 'scene';
};
const codeUnitOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Cross-record repairs of meshes and groups (M6A-SPEC §4.2): a `parent` that is missing, deleted, of another owner or
 * of the wrong table (a group's parent must be a group) becomes null; a parent cycle is broken by detaching its
 * member with the smallest id; live mesh names are made unique per owner by appending ' 2', ' 3', … (in id order, the
 * first keeps its name). Returns new tables only where something changed.
 */
export function repairHierarchy(
  meshes: Readonly<Record<string, unknown>>,
  groups: Readonly<Record<string, unknown>>,
): {
  readonly meshes: Readonly<Record<string, unknown>>;
  readonly groups: Readonly<Record<string, unknown>>;
  readonly problems: readonly string[];
} {
  const problems: string[] = [];
  const rows = new Map<string, { table: 'meshes' | 'groups'; row: Obj }>();
  for (const [table, records] of [
    ['meshes', meshes],
    ['groups', groups],
  ] as const) {
    for (const [id, row] of Object.entries(records)) if (isObj(row) && isLive(row)) rows.set(id, { table, row });
  }
  const parentOf = new Map<string, string | null>();
  for (const [id, { table, row }] of rows) {
    const parent = row['parent'];
    let next: string | null = null;
    if (typeof parent === 'string' && parent.length > 0) {
      const target = rows.get(parent);
      const valid =
        target !== undefined &&
        ownerKey(target.row) === ownerKey(row) &&
        (table === 'meshes' || target.table === 'groups');
      if (valid) next = parent;
      else
        problems.push(
          `${table}/${id}: parent ${parent} is missing, deleted, of another owner or not a group; set to null`,
        );
    }
    parentOf.set(id, next);
  }
  // Each component of a parent-pointer graph holds at most one cycle: walk until a known node.
  const state = new Map<string, 1 | 2>();
  for (const start of [...rows.keys()].sort(codeUnitOrder)) {
    if (state.has(start)) continue;
    const walk: string[] = [];
    let current: string | null = start;
    while (current !== null && !state.has(current)) {
      state.set(current, 1);
      walk.push(current);
      current = parentOf.get(current) ?? null;
    }
    if (current !== null && state.get(current) === 1) {
      const cycle = walk.slice(walk.indexOf(current));
      const smallest = cycle.reduce((min, id) => (codeUnitOrder(id, min) < 0 ? id : min));
      parentOf.set(smallest, null);
      problems.push(`${rows.get(smallest)?.table}/${smallest}: parent cycle broken, parent set to null`);
    }
    for (const id of walk) state.set(id, 2);
  }
  // Unique live mesh names per owner.
  const names = new Map<string, Map<string, string>>();
  const renamed = new Map<string, string>();
  for (const id of [...rows.keys()].sort(codeUnitOrder)) {
    const entry = rows.get(id);
    if (entry === undefined || entry.table !== 'meshes' || typeof entry.row['name'] !== 'string') continue;
    const owner = ownerKey(entry.row);
    let used = names.get(owner);
    if (used === undefined) {
      used = new Map();
      for (const other of rows.values()) {
        if (other.table === 'meshes' && ownerKey(other.row) === owner && typeof other.row['name'] === 'string') {
          used.set(other.row['name'], '');
        }
      }
      names.set(owner, used);
    }
    const name = entry.row['name'];
    const holder = used.get(name);
    if (holder === '' || holder === id) {
      used.set(name, id);
      continue;
    }
    let n = 2;
    let candidate = `${name.slice(0, MESH_NAME_MAX - 2)} ${n}`;
    while (used.has(candidate)) {
      n++;
      const suffix = ` ${n}`;
      candidate = `${name.slice(0, MESH_NAME_MAX - suffix.length)}${suffix}`;
    }
    used.set(candidate, id);
    renamed.set(id, candidate);
    problems.push(`meshes/${id}: name '${name}' is used by another mesh of the owner, renamed '${candidate}'`);
  }

  const rebuild = (table: 'meshes' | 'groups', records: Readonly<Record<string, unknown>>) => {
    let out: Record<string, unknown> | null = null;
    for (const [id, value] of Object.entries(records)) {
      if (!isObj(value) || !rows.has(id)) continue;
      const parent = parentOf.get(id) ?? null;
      const name = renamed.get(id);
      const parentChanged = (value['parent'] ?? null) !== parent;
      if (!parentChanged && name === undefined) continue;
      out ??= { ...records };
      out[id] = { ...value, ...(parentChanged ? { parent } : {}), ...(name === undefined ? {} : { name }) };
    }
    return out ?? records;
  };
  return { meshes: rebuild('meshes', meshes), groups: rebuild('groups', groups), problems };
}
