// Reader rules for skin and morph layers (M6A-SPEC §4.2 `MeshRef.joints`, §9 B7 tests): what the display rebuild
// and the exporters read from a revision, never from other records.
//
// - **Joint palette**: a `skin.skeleton` mesh's palette is the `skin.joints` layer meta (`{ joints: [{ id, parent }] }`)
//   of its manifest, in palette order; `MeshRef.joints` copies it. An imported skin (`skin: { asset, skin }`) has
//   `joints: []` and its palette lives only in the layer meta as glTF joint indices: it is never folded.
// - **Dangling joints** (a peer undid "add joint" after another peer wrote weights on it): influences of a palette
//   joint without a live JointRecord fold onto its nearest live ancestor along the manifest's parents (a root without
//   a live ancestor folds onto the first live palette root); merged influences add up, the top 4 are kept and
//   renormalized; the read carries the warning `skin.dangling-joint`.
// - **Morph names** come from the manifest's `morph:<name>` layers only, in manifest order.
import type { JointId, MeshRecord } from '@ekza-studio/doc';
import type { MeshData, OpWarning } from '@ekza-studio/mesh-core';

export interface PaletteJoint {
  readonly id: string;
  readonly parent: string | null;
}

export interface SkinRead {
  /** Palette joints in manifest order (empty without a `skin.joints` layer). */
  readonly palette: readonly PaletteJoint[];
  /** Per-vertex joint palette indices (×4) after folding; null without a skin layer. */
  readonly joints: Uint16Array | null;
  /** Per-vertex weights (×4) after folding, each row summing to 1; null without a skin layer. */
  readonly weights: Float32Array | null;
  /** Palette index → the index its influences fold onto (identity for live joints). */
  readonly fold: Int32Array;
  readonly warnings: readonly OpWarning[];
}

const SKIN_JOINTS = 'skin.joints';
const SKIN_WEIGHTS = 'skin.weights';

/** The palette of the `skin.joints` layer meta (manifest order). */
export function jointPaletteOf(data: MeshData): readonly PaletteJoint[] {
  const meta = data.layers.get(SKIN_JOINTS)?.def.meta;
  const joints = (meta as { joints?: unknown } | undefined)?.joints;
  if (!Array.isArray(joints)) return [];
  const out: PaletteJoint[] = [];
  for (const joint of joints) {
    const id = (joint as { id?: unknown } | null)?.id;
    const parent = (joint as { parent?: unknown } | null)?.parent;
    out.push({ id: typeof id === 'string' ? id : String(id), parent: typeof parent === 'string' ? parent : null });
  }
  return out;
}

/** `MeshRef.joints` for a revision of `record`: the palette ids of a `skin.skeleton` mesh, else []. */
export function refJointsOf(record: Pick<MeshRecord, 'skin'>, data: MeshData): readonly JointId[] {
  const skin = record.skin;
  if (skin === null || !('skeleton' in skin)) return [];
  return jointPaletteOf(data).map((joint) => joint.id as JointId);
}

/** Morph target names, from the manifest's `morph:<name>` layers in manifest order. */
export function morphNamesOf(data: MeshData): readonly string[] {
  const out: string[] = [];
  for (const name of data.layers.keys()) if (name.startsWith('morph:')) out.push(name.slice('morph:'.length));
  return out;
}

/** Reads the skin of a revision with the dangling-joint fold (only for `skin.skeleton` meshes). */
export function readSkin(
  record: Pick<MeshRecord, 'skin'>,
  data: MeshData,
  isLiveJoint: (id: string) => boolean,
): SkinRead {
  const palette = jointPaletteOf(data);
  const fold = new Int32Array(palette.length);
  for (let i = 0; i < fold.length; i++) fold[i] = i;
  const jointsLayer = data.layers.get(SKIN_JOINTS);
  const weightsLayer = data.layers.get(SKIN_WEIGHTS);
  const joints = jointsLayer === undefined ? null : Uint16Array.from(jointsLayer.data);
  const weights = weightsLayer === undefined ? null : Float32Array.from(weightsLayer.data);
  const skin = record.skin;
  if (skin === null || !('skeleton' in skin) || palette.length === 0) {
    return { palette, joints, weights, fold, warnings: [] };
  }
  const index = new Map<string, number>();
  palette.forEach((joint, i) => {
    if (!index.has(joint.id)) index.set(joint.id, i);
  });
  const firstLiveRoot = palette.findIndex((joint) => joint.parent === null && isLiveJoint(joint.id));
  let dangling = 0;
  for (let i = 0; i < palette.length; i++) {
    const joint = palette[i] as PaletteJoint;
    if (isLiveJoint(joint.id)) continue;
    dangling++;
    let target = -1;
    const seen = new Set<string>([joint.id]);
    let parent = joint.parent;
    while (parent !== null && !seen.has(parent)) {
      seen.add(parent);
      const at = index.get(parent);
      if (at === undefined) break;
      if (isLiveJoint(parent)) {
        target = at;
        break;
      }
      parent = (palette[at] as PaletteJoint).parent;
    }
    fold[i] = target >= 0 ? target : firstLiveRoot >= 0 ? firstLiveRoot : i;
  }
  if (dangling === 0 || joints === null || weights === null) {
    return { palette, joints, weights, fold, warnings: dangling === 0 ? [] : [danglingWarning(dangling)] };
  }
  const points = Math.floor(joints.length / 4);
  const ids = new Int32Array(4);
  const ws = new Float64Array(4);
  for (let v = 0; v < points; v++) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights[4 * v + k] as number;
      if (w === 0) continue;
      const raw = joints[4 * v + k] ?? 0;
      const j = fold[raw] ?? raw;
      let slot = -1;
      for (let s = 0; s < n; s++) if (ids[s] === j) slot = s;
      if (slot < 0) {
        ids[n] = j;
        ws[n] = w;
        n++;
      } else {
        ws[slot] = (ws[slot] as number) + w;
      }
    }
    // Sort by weight (desc), ties to the smaller joint index; renormalize.
    const order = [0, 1, 2, 3]
      .slice(0, n)
      .sort((a, b) => (ws[b] as number) - (ws[a] as number) || (ids[a] as number) - (ids[b] as number));
    let sum = 0;
    for (const s of order) sum += ws[s] as number;
    for (let k = 0; k < 4; k++) {
      const s = order[k];
      joints[4 * v + k] = s === undefined ? 0 : (ids[s] as number);
      weights[4 * v + k] = s === undefined || sum === 0 ? 0 : Math.fround((ws[s] as number) / sum);
    }
  }
  return { palette, joints, weights, fold, warnings: [danglingWarning(dangling)] };
}

function danglingWarning(count: number): OpWarning {
  return {
    code: 'skin.dangling-joint',
    message: `${count} joint${count === 1 ? '' : 's'} of the skin no longer exist${count === 1 ? 's' : ''}: weights moved to the nearest parent`,
    count,
  };
}
