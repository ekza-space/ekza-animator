// World placement of mesh records (M6A-SPEC §4.2 `placement`, §5.15): the record's placement composed with its
// parents' (groups or meshes of the same owner) up to the owner root (the scene, or a character's root), as the
// column-major matrix mesh-view and the picker take. A parent that is missing, deleted, of another owner or closes
// a cycle ends the chain there (the queries treat such a record as a root, §4.2 load repairs).
import { mat4Compose, mat4Identity, mat4Multiply } from '@ekza-animator/anim-core';
import type { CharacterId, GroupRecord, MeshRecord, ReadView } from '@ekza-animator/doc';

/** Longest parent chain followed (deeper chains are cut, as a cycle would be). */
const MAX_DEPTH = 64;

function sameOwner(a: MeshRecord | GroupRecord, b: MeshRecord | GroupRecord): boolean {
  const ca = 'character' in a.owner ? a.owner.character : null;
  const cb = 'character' in b.owner ? b.owner.character : null;
  return ca === cb;
}

/**
 * World from local of `record`: owner root × … × parent placement × record placement. `characterWorld` gives the
 * root of a character-owned record (null = identity).
 */
export function meshWorld(
  view: ReadView,
  record: MeshRecord,
  characterWorld: ((character: CharacterId) => Float64Array | null) | null,
  out: Float64Array = new Float64Array(16),
): Float64Array {
  const chain: (MeshRecord | GroupRecord)[] = [record];
  const seen = new Set<string>([record.id]);
  let current: MeshRecord | GroupRecord = record;
  while (current.parent !== null && chain.length < MAX_DEPTH) {
    const id: string = current.parent;
    if (seen.has(id)) break;
    const parent: MeshRecord | GroupRecord | undefined =
      view.get('groups', id as GroupRecord['id']) ?? view.get('meshes', id as MeshRecord['id']);
    if (parent === undefined || !sameOwner(parent, record)) break;
    seen.add(id);
    chain.push(parent);
    current = parent;
  }
  const root = 'character' in record.owner && characterWorld !== null ? characterWorld(record.owner.character) : null;
  if (root === null) mat4Identity(out);
  else out.set(root);
  const m = out;
  const local = new Float64Array(16);
  const tmp = new Float64Array(16);
  for (let i = chain.length - 1; i >= 0; i--) {
    mat4Compose((chain[i] as MeshRecord | GroupRecord).placement, local);
    mat4Multiply(m, local, tmp);
    m.set(tmp);
  }
  return m;
}

/** True when the object or one of its ancestors is in `set` (hidden objects, isolate lists hold groups too). */
export function inSubtree(view: ReadView, record: MeshRecord, set: ReadonlySet<string>): boolean {
  let current: MeshRecord | GroupRecord | undefined = record;
  for (let depth = 0; current !== undefined && depth < MAX_DEPTH; depth++) {
    if (set.has(current.id)) return true;
    const parent: string | null = current.parent;
    if (parent === null) return false;
    current = view.get('groups', parent as GroupRecord['id']) ?? view.get('meshes', parent as MeshRecord['id']);
  }
  return false;
}

/** Below this share of the largest coefficient a local axis does not count (rounding of a 90° rotation). */
const OBLIQUE = 1e-6;

/**
 * The world plane `axis = 0` (World symmetry, §5.14) in the mesh-local terms mesh-view draws a symmetry plane with:
 * the one local axis the world coordinate depends on and the local offset where it is 0. null when the world
 * coordinate mixes several local axes (a rotation that is not a multiple of 90°): no local axis plane matches, and
 * the partner map (B7) decides what such a mesh mirrors.
 */
export function worldPlaneInLocal(
  world: Float64Array,
  axis: 'x' | 'y' | 'z',
): { readonly axis: 'x' | 'y' | 'z'; readonly offset: number } | null {
  const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  // Column-major: world_k = m[k]·x + m[4 + k]·y + m[8 + k]·z + m[12 + k].
  const coefficients = [world[k] as number, world[4 + k] as number, world[8 + k] as number];
  const largest = Math.max(...coefficients.map(Math.abs));
  if (!(largest > 0)) return null;
  let local = -1;
  for (let c = 0; c < 3; c++) {
    if (Math.abs(coefficients[c] as number) <= largest * OBLIQUE) continue;
    if (local !== -1) return null;
    local = c;
  }
  const names = ['x', 'y', 'z'] as const;
  const offset = -(world[12 + k] as number) / (coefficients[local] as number);
  return { axis: names[local] as 'x' | 'y' | 'z', offset: offset === 0 ? 0 : offset };
}
