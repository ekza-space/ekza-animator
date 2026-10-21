// Skin value objects over the mesh layers (M6B-SPEC §4.2; C0 working baselines, then C5's). The storage is M6a's
// `skin.joints` (u16 × 4) and `skin.weights` (f32 × 4) point layers; the palette is the `skin.joints` layer meta
// `{ joints: [{ id, parent, mirror? }] }` (ADR 0015 §8; `mirror` only when known, CR-6), and the review layer is the
// point layer `group:skin.review` (u8, interp 'or', mirror 'none') with the meta `{ reason, source }` (§5.14).
//
// Round trip (P8): `withSkin(data, readSkin(data))` gives a MeshData whose manifest equals `data`'s — the meta keeps
// its key set (`mirror` is written only when non-null) and the arrays are copied value for value.
import { EkzaError } from '@ekza-studio/anim-core';
import { BUILTIN_LAYERS } from '../layers/builtin';
import type { EditMesh, LayerDef, MeshData } from '../types';
import type { SkinPaletteEntry, SkinReview, SkinWeights } from './types';

/** Point layer (u8, interp 'or', mirror 'none'): points to review after a fill or a transfer (§5.14). */
export const SKIN_REVIEW_LAYER = 'group:skin.review' as const;

const SKIN_JOINTS = BUILTIN_LAYERS.skinJoints.name;
const SKIN_WEIGHTS = BUILTIN_LAYERS.skinWeights.name;

type LayerRead = { readonly def: LayerDef; readonly data: ArrayLike<number> };

function isEditMesh(m: MeshData | EditMesh): m is EditMesh {
  return typeof (m as EditMesh).layer === 'function';
}

function layerOf(m: MeshData | EditMesh, name: string): LayerRead | undefined {
  if (isEditMesh(m)) {
    const layer = m.layer(name);
    return layer === undefined ? undefined : { def: layer.def, data: layer.data };
  }
  return m.layers.get(name);
}

/** The palette of a `skin.joints` layer meta (entries without a usable id are kept as their string form). */
function paletteOf(meta: Readonly<Record<string, unknown>> | undefined): SkinPaletteEntry[] {
  const joints = meta?.['joints'];
  if (!Array.isArray(joints)) return [];
  const out: SkinPaletteEntry[] = [];
  for (const joint of joints as readonly unknown[]) {
    const row = typeof joint === 'object' && joint !== null ? (joint as Readonly<Record<string, unknown>>) : {};
    const id = row['id'];
    const parent = row['parent'];
    const mirror = row['mirror'];
    out.push({
      key: typeof id === 'string' ? id : String(id),
      parent: typeof parent === 'string' ? parent : null,
      mirror: typeof mirror === 'string' ? mirror : null,
    });
  }
  return out;
}

/** The skin of a mesh, or null when it has no `skin.joints`/`skin.weights` layers. The arrays are copies. */
export function readSkin(m: MeshData | EditMesh): SkinWeights | null {
  const joints = layerOf(m, SKIN_JOINTS);
  const weights = layerOf(m, SKIN_WEIGHTS);
  if (joints === undefined || weights === undefined) return null;
  const points = m.counts.points;
  const outJoints = new Uint16Array(4 * points);
  const outWeights = new Float32Array(4 * points);
  for (let i = 0; i < 4 * points; i++) {
    outJoints[i] = joints.data[i] ?? 0;
    outWeights[i] = weights.data[i] ?? 0;
  }
  return { points, palette: paletteOf(joints.def.meta), joints: outJoints, weights: outWeights };
}

/** The review state of a mesh (§5.14), or null without a review layer or without a point to review. */
export function readSkinReview(m: MeshData | EditMesh): SkinReview | null {
  const layer = layerOf(m, SKIN_REVIEW_LAYER);
  if (layer === undefined) return null;
  const points: number[] = [];
  for (let p = 0; p < m.counts.points; p++) if ((layer.data[p] ?? 0) !== 0) points.push(p);
  if (points.length === 0) return null;
  const meta = layer.def.meta;
  const source = meta?.['source'];
  return {
    reason: meta?.['reason'] === 'transferred' ? 'transferred' : 'filled',
    source: typeof source === 'string' ? source : null,
    points: Uint32Array.from(points),
  };
}

/** The `skin.joints` layer meta of a palette (`mirror` only when known, so an M6a palette round-trips unchanged). */
function paletteMeta(palette: readonly SkinPaletteEntry[]): Readonly<Record<string, unknown>> {
  return {
    joints: palette.map((entry) =>
      entry.mirror === null
        ? { id: entry.key, parent: entry.parent }
        : { id: entry.key, parent: entry.parent, mirror: entry.mirror },
    ),
  };
}

/**
 * A MeshData sharing every array of `data` except the skin layers, their meta and the review layer. `skin` null
 * removes the skin layers; `review` undefined keeps the review layer as it is, null removes it. Layers keep their
 * position in the layer order when replaced; new layers are appended.
 */
export function withSkin(data: MeshData, skin: SkinWeights | null, review?: SkinReview | null): MeshData {
  const points = data.counts.points;
  const layers = new Map(data.layers);
  if (skin === null) {
    layers.delete(SKIN_JOINTS);
    layers.delete(SKIN_WEIGHTS);
  } else {
    if (skin.points !== points || skin.joints.length !== 4 * points || skin.weights.length !== 4 * points) {
      throw new EkzaError('invalid-input', `withSkin: the skin has ${skin.points} points, the mesh ${points}`);
    }
    layers.set(SKIN_JOINTS, {
      def: { ...BUILTIN_LAYERS.skinJoints, meta: paletteMeta(skin.palette) },
      data: Uint16Array.from(skin.joints),
    });
    layers.set(SKIN_WEIGHTS, {
      def: data.layers.get(SKIN_WEIGHTS)?.def ?? BUILTIN_LAYERS.skinWeights,
      data: Float32Array.from(skin.weights),
    });
  }
  if (review === null) layers.delete(SKIN_REVIEW_LAYER);
  else if (review !== undefined) {
    const flags = new Uint8Array(points);
    for (const p of review.points) if (p < points) flags[p] = 1;
    layers.set(SKIN_REVIEW_LAYER, {
      def: {
        name: SKIN_REVIEW_LAYER,
        domain: 'point',
        type: 'u8',
        comps: 1,
        interp: 'or',
        mirror: 'none',
        default: [0],
        meta: { reason: review.reason, source: review.source },
      },
      data: flags,
    });
  }
  return { ...data, layers };
}
