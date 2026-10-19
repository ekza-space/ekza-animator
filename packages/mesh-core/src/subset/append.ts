// `appendMesh` (M6A-SPEC §4.3, §5.13): appends a stored mesh b into the edit mesh a inside a's open transaction, with b's
// positions transformed b-local → a-local. Remaps: material slots by identity key (new keys get slots after a's),
// palette slots (identity: Combine refuses differing palettes), morph layers by name (a's manifest order first, missing
// deltas zero), the joint palette of `skin.joints` (union, a's order first; b's joint indices remapped). When
// det(xf) < 0 (a mirrored duplicate) every appended face's corner order is reversed together with its corner values and
// custom normals go through the inverse transpose, so the result faces outward. Appended vertices and faces are
// contiguous: [P₀, P₀ + b.points) and [F₀, F₀ + b.faces) in b's order.
import type { ReadonlyXf } from '@ekza-animator/anim-core';
import { SKIN_JOINTS } from '../layers/builtin';
import type { AppendResult, AttrLayer, EditMesh, LayerDef, MeshData } from '../types';
import {
  det3,
  isNormalLayer,
  isVectorLayer,
  matrixOf,
  normalMatrix,
  transformNormal,
  transformPoint,
  transformVector,
} from './matrix';

export function appendMesh(
  a: EditMesh,
  b: MeshData,
  xf: ReadonlyXf,
  opts: { readonly materials: readonly [readonly string[], readonly string[]] },
): AppendResult {
  return appendMeshMatrix(a, b, matrixOf(xf), opts.materials).result;
}

export interface AppendInfo {
  readonly result: AppendResult;
  /** First appended vertex and face (they are contiguous). */
  readonly firstPoint: number;
  readonly firstFace: number;
}

type Stored = { readonly def: LayerDef; readonly data: ArrayLike<number> };

function paletteNames(def: LayerDef): string[] {
  const joints = (def.meta as { readonly joints?: unknown } | undefined)?.joints;
  if (!Array.isArray(joints)) return [];
  return joints.map((joint) => {
    const id = (joint as { readonly id?: unknown } | null)?.id;
    return typeof id === 'string' ? id : '';
  });
}

function sameShape(x: LayerDef, y: LayerDef): boolean {
  return x.domain === y.domain && x.type === y.type && x.comps === y.comps;
}

/** Re-declares a's joint layer with a longer palette (layer metadata is part of the definition), keeping the values. */
function widenPalette(a: EditMesh, layer: AttrLayer, union: readonly string[]): AttrLayer {
  const def = layer.def;
  const oldJoints = ((def.meta as { readonly joints?: unknown } | undefined)?.joints ?? []) as readonly unknown[];
  const joints: unknown[] = [...oldJoints];
  for (let i = oldJoints.length; i < union.length; i++) joints.push({ id: union[i], parent: null });
  const count = a.counts.points * def.comps;
  const values = new Float64Array(count);
  for (let i = 0; i < count; i++) values[i] = layer.data[i] as number;
  a.removeLayer(def.name);
  const widened = a.addLayer({ ...def, meta: { ...def.meta, joints } });
  for (let v = 0; v < a.counts.points; v++) {
    for (let k = 0; k < def.comps; k++) {
      const value = values[v * def.comps + k] as number;
      if (value !== (def.default[k] ?? 0)) widened.set(v, k, value);
    }
  }
  return widened;
}

const OUT = new Float64Array(3);

/** `appendMesh` with a general column-major 4×4 (Combine composes placements that need not be TRS). */
export function appendMeshMatrix(
  a: EditMesh,
  b: MeshData,
  matrix: ArrayLike<number>,
  materials: readonly [readonly string[], readonly string[]],
  opts?: { readonly layers?: 'all' | readonly string[] },
): AppendInfo {
  const flip = det3(matrix) < 0;
  const normals = normalMatrix(matrix);
  const [aKeys, bKeys] = materials;

  // Material slots by identity key; unknown slots (no key) keep their index.
  let slots = bKeys.length;
  for (let f = 0; f < b.counts.faces; f++) slots = Math.max(slots, (b.faceMaterial[f] as number) + 1);
  const materialSlots = new Int32Array(slots);
  const added: string[] = [];
  for (let s = 0; s < slots; s++) {
    const key = bKeys[s];
    if (key === undefined) {
      materialSlots[s] = s;
      continue;
    }
    let at = aKeys.indexOf(key);
    if (at === -1) {
      const already = added.indexOf(key);
      at = already === -1 ? aKeys.length + added.push(key) - 1 : aKeys.length + already;
    }
    materialSlots[s] = at;
  }

  // Layers: b's layers onto a's (added where missing); the joint palette united.
  const keep = opts?.layers ?? 'all';
  const targets: { readonly src: Stored; readonly dst: AttrLayer }[] = [];
  let jointRemap: Int32Array | null = null;
  let jointPalette: readonly string[] | null = null;
  const aJoints = a.layer(SKIN_JOINTS);
  if (aJoints !== undefined) jointPalette = paletteNames(aJoints.def);
  for (const [name, src] of b.layers) {
    if (keep !== 'all' && !keep.includes(name)) continue;
    let dst = a.layer(name);
    if (name === SKIN_JOINTS) {
      const bNames = paletteNames(src.def);
      if (dst === undefined) {
        dst = a.addLayer(src.def);
        jointPalette = bNames;
        jointRemap = Int32Array.from(bNames, (_, i) => i);
      } else {
        const union = [...paletteNames(dst.def)];
        jointRemap = new Int32Array(bNames.length);
        bNames.forEach((joint, i) => {
          let at = union.indexOf(joint);
          if (at === -1) at = union.push(joint) - 1;
          (jointRemap as Int32Array)[i] = at;
        });
        if (union.length > paletteNames(dst.def).length) dst = widenPalette(a, dst, union);
        jointPalette = union;
      }
    } else if (dst === undefined) {
      dst = a.addLayer(src.def);
    }
    if (!sameShape(dst.def, src.def)) continue;
    targets.push({ src, dst });
  }
  // Layer handles stay valid until their layer is removed: re-read them after any palette widening.
  const live = targets.map((t) => ({ src: t.src, dst: a.layer(t.dst.def.name) as AttrLayer }));

  let paintSlots: Int32Array | null = null;
  const paint = b.layers.get('paint');
  if (paint !== undefined) {
    let max = 0;
    for (let f = 0; f < b.counts.faces; f++) max = Math.max(max, paint.data[f] as number);
    paintSlots = Int32Array.from({ length: max + 1 }, (_, i) => i);
  }

  // Vertices.
  const firstPoint = a.counts.points;
  const p = b.position;
  for (let v = 0; v < b.counts.points; v++) {
    transformPoint(matrix, p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number, OUT);
    a.makeVert((OUT[0] as number) + 0, (OUT[1] as number) + 0, (OUT[2] as number) + 0);
  }
  for (const { src, dst } of live) {
    if (src.def.domain !== 'point') continue;
    const comps = src.def.comps;
    const vector = isVectorLayer(src.def);
    const joints = src.def.name === SKIN_JOINTS ? jointRemap : null;
    for (let v = 0; v < b.counts.points; v++) {
      const at = v * comps;
      if (vector) {
        transformVector(matrix, src.data[at] as number, src.data[at + 1] as number, src.data[at + 2] as number, OUT);
        for (let k = 0; k < 3; k++) dst.set(firstPoint + v, k, (OUT[k] as number) + 0);
        for (let k = 3; k < comps; k++) dst.set(firstPoint + v, k, src.data[at + k] as number);
        continue;
      }
      for (let k = 0; k < comps; k++) {
        let value = src.data[at + k] as number;
        if (joints !== null && value < joints.length) value = joints[value] as number;
        dst.set(firstPoint + v, k, value);
      }
    }
  }

  // Faces (corners positional: the new face's cycle starts at the first listed vertex).
  const firstFace = a.counts.faces;
  const verts: number[] = [];
  const corners: number[] = [];
  for (let f = 0; f < b.counts.faces; f++) {
    verts.length = 0;
    corners.length = 0;
    const start = b.faceCorner[f] as number;
    let c = start;
    let guard = 0;
    do {
      corners.push(c);
      verts.push(firstPoint + (b.cornerVert[c] as number));
      c = b.cornerNext[c] as number;
    } while (c !== start && ++guard <= b.counts.corners);
    if (flip) {
      verts.reverse();
      corners.reverse();
    }
    const slot = b.faceMaterial[f] ?? 0;
    const material = materialSlots[slot] ?? slot;
    const face = a.makeFace(verts, { material });
    if ((b.faceFlags[f] as number) !== 0) a.setFaceFlags(face, b.faceFlags[f] as number);
    for (const { src, dst } of live) {
      const comps = src.def.comps;
      if (src.def.domain === 'face') {
        for (let k = 0; k < comps; k++) {
          let value = src.data[f * comps + k] as number;
          if (src.def.name === 'paint' && paintSlots !== null) value = paintSlots[value] ?? value;
          dst.set(face, k, value);
        }
      } else if (src.def.domain === 'corner') {
        const normal = normals !== null && isNormalLayer(src.def);
        let nc = a.faceCorner(face);
        for (const bc of corners) {
          const at = bc * comps;
          if (normal) {
            transformNormal(
              normals,
              src.data[at] as number,
              src.data[at + 1] as number,
              src.data[at + 2] as number,
              OUT,
            );
            for (let k = 0; k < 3; k++) dst.set(nc, k, (OUT[k] as number) + 0);
            for (let k = 3; k < comps; k++) dst.set(nc, k, src.data[at + k] as number);
          } else {
            for (let k = 0; k < comps; k++) dst.set(nc, k, src.data[at + k] as number);
          }
          nc = a.cornerNext(nc);
        }
      }
    }
  }

  // Edges: flags and layers by endpoint pair (wire edges of b are created).
  for (let e = 0; e < b.counts.edges; e++) {
    const v0 = firstPoint + (b.edgeVerts[2 * e] as number);
    const v1 = firstPoint + (b.edgeVerts[2 * e + 1] as number);
    let edge = a.findEdge(v0, v1);
    if (edge === -1) edge = a.makeEdge(v0, v1);
    if (a.edgeFlags(edge) !== (b.edgeFlags[e] as number)) a.setEdgeFlags(edge, b.edgeFlags[e] as number);
    for (const { src, dst } of live) {
      if (src.def.domain !== 'edge') continue;
      for (let k = 0; k < src.def.comps; k++) dst.set(edge, k, src.data[e * src.def.comps + k] as number);
    }
  }

  const morphLayers = a
    .layers()
    .map((layer) => layer.def.name)
    .filter((name) => name.startsWith('morph:'));
  return {
    result: { materialSlots, paintSlots, morphLayers, jointPalette },
    firstPoint,
    firstFace,
  };
}
