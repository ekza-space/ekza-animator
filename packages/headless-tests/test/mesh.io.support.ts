// Shared helpers of the mesh.io.* headless tests (M6A-SPEC §9 B8): Make editable on an imported fixture, a topology
// edit that needs no kernel Euler operator (faces split at their centroids, written as a new revision through
// `MeshRuntimeRegistry.writeData`, the path every M6a op commits through), a keyed clip, GLB JSON helpers and the
// preservation check of the surgeon (§5.22, E2E-MOD-12).
import type { CharacterId, ClipId, MeshId } from '@ekza-animator/doc';
import { assetMeshId, type EditorApp } from '@ekza-animator/editor-core';
import type { GlbContainer } from '@ekza-animator/io';
import type { LayerDef, MeshData } from '@ekza-animator/mesh-core';
import { expect } from 'vitest';
import { runOk, setSceneFrame } from './ops.support';

type Json = Record<string, unknown>;

export async function makeEditable(app: EditorApp, character: CharacterId, meshIndex: number): Promise<MeshId> {
  const value = (await runOk(app, 'mesh.makeEditable', { character, meshIndex })) as { mesh: MeshId };
  expect(value.mesh).toBe(assetMeshId(character, meshIndex));
  return value.mesh;
}

export function meshData(app: EditorApp, mesh: MeshId): MeshData {
  const data = app.meshes.get(mesh)?.data();
  if (data === null || data === undefined) throw new Error(`mesh ${mesh} has no data`);
  return data;
}

/** Splits the first `count` faces at their centroids and commits the result as the mesh's next revision. */
export function splitAndCommit(app: EditorApp, mesh: MeshId, count: number): MeshData {
  const data = meshData(app, mesh);
  const edited = splitFaces(
    data,
    Array.from({ length: Math.min(count, data.counts.faces) }, (_, f) => f),
  );
  app.store.transact({ label: 'Split' }, (tx) => app.meshes.writeData(tx, mesh, edited));
  return edited;
}

/** A clip `name` of the character with two rz keys on one control (so a bake has something to write). */
export async function keyedClip(app: EditorApp, character: CharacterId, name = 'wave'): Promise<ClipId> {
  const clip = ((await runOk(app, 'clip.new', { character, name, range: { start: 0, end: 10 } })) as { clip: ClipId })
    .clip;
  const rig = app.store.query.rigOfCharacter(character);
  // Humanoids key the left forearm; generic rigs (the UAL mannequin) their second control.
  const control =
    rig === undefined
      ? undefined
      : (app.store.query.controlByKey(rig.id, 'fk.lowerArm.L') ?? app.store.query.controlsOfRig(rig.id)[1]);
  if (control === undefined) throw new Error('the rig has no control to key');
  await runOk(app, 'clip.setActive', { clip });
  for (const [frame, value] of [
    [0, 0.5],
    [10, -0.5],
  ] as const) {
    setSceneFrame(app, frame);
    await runOk(app, 'channel.setValues', {
      edits: [{ control: control.id, channel: 'rz', value }],
      key: 'force',
    });
  }
  return clip;
}

/** Every face split into a fan around its centroid (point layers averaged, skin copied, corner layers averaged). */
export function splitFaces(data: MeshData, split: readonly number[]): MeshData {
  const { faces: F, points: P } = data.counts;
  const splitSet = new Set(split);
  const cornersOf = (f: number): number[] => {
    const out: number[] = [];
    let c = data.faceCorner[f] as number;
    do {
      out.push(c);
      c = data.cornerNext[c] as number;
    } while (c !== data.faceCorner[f]);
    return out;
  };
  const faces: { verts: number[]; corners: number[]; face: number }[] = [];
  const centres: (readonly number[])[] = [];
  for (let f = 0; f < F; f++) {
    const corners = cornersOf(f);
    if (!splitSet.has(f)) {
      faces.push({ verts: corners.map((c) => data.cornerVert[c] as number), corners, face: f });
      continue;
    }
    const centre = P + centres.length;
    centres.push(corners);
    corners.forEach((c, i) => {
      const next = corners[(i + 1) % corners.length] as number;
      faces.push({
        verts: [data.cornerVert[c] as number, data.cornerVert[next] as number, centre],
        corners: [c, next, -centres.length],
        face: f,
      });
    });
  }
  const P2 = P + centres.length;
  const position = new Float32Array(3 * P2);
  position.set(data.position);
  centres.forEach((corners, i) => {
    for (let k = 0; k < 3; k++) {
      let sum = 0;
      for (const c of corners) sum += data.position[3 * (data.cornerVert[c] as number) + k] as number;
      position[3 * (P + i) + k] = sum / corners.length;
    }
  });
  const C2 = faces.reduce((sum, face) => sum + face.verts.length, 0);
  const cornerVert = new Uint32Array(C2);
  const cornerNext = new Uint32Array(C2);
  const faceCorner = new Uint32Array(faces.length);
  const faceMaterial = new Uint16Array(faces.length);
  const source: number[] = [];
  let c2 = 0;
  faces.forEach((face, f) => {
    faceCorner[f] = c2;
    faceMaterial[f] = data.faceMaterial[face.face] as number;
    face.verts.forEach((v, i) => {
      cornerVert[c2 + i] = v;
      cornerNext[c2 + i] = c2 + ((i + 1) % face.verts.length);
      source.push(face.corners[i] as number);
    });
    c2 += face.verts.length;
  });
  const flagsOf = new Map<string, number>();
  for (let e = 0; e < data.counts.edges; e++) {
    const a = data.edgeVerts[2 * e] as number;
    const b = data.edgeVerts[2 * e + 1] as number;
    flagsOf.set(a < b ? `${a},${b}` : `${b},${a}`, data.edgeFlags[e] as number);
  }
  const edgeIndex = new Set<string>();
  const edgeVerts: number[] = [];
  const edgeFlags: number[] = [];
  for (let c = 0; c < C2; c++) {
    const a = cornerVert[c] as number;
    const b = cornerVert[cornerNext[c] as number] as number;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (edgeIndex.has(key)) continue;
    edgeIndex.add(key);
    edgeVerts.push(a, b);
    edgeFlags.push(flagsOf.get(key) ?? 0);
  }
  type Arr = Float32Array | Uint8Array | Uint16Array | Uint32Array;
  const layers = new Map<string, { readonly def: LayerDef; readonly data: Arr }>();
  for (const [name, layer] of data.layers) {
    const comps = layer.def.comps;
    const Ctor = layer.data.constructor as new (n: number) => Arr;
    if (layer.def.domain === 'point') {
      const out = new Ctor(P2 * comps);
      out.set(layer.data);
      centres.forEach((corners, i) => {
        const first = data.cornerVert[corners[0] as number] as number;
        for (let k = 0; k < comps; k++) {
          let value = layer.data[first * comps + k] as number;
          if (!name.startsWith('skin.')) {
            let sum = 0;
            for (const c of corners) sum += layer.data[(data.cornerVert[c] as number) * comps + k] as number;
            value = sum / corners.length;
          }
          out[(P + i) * comps + k] = value;
        }
      });
      layers.set(name, { def: layer.def, data: out });
    } else if (layer.def.domain === 'corner') {
      const out = new Ctor(C2 * comps);
      source.forEach((s, c) => {
        if (s >= 0) {
          for (let k = 0; k < comps; k++) out[c * comps + k] = layer.data[s * comps + k] as number;
          return;
        }
        if (name === 'normal.custom') return;
        const corners = centres[-s - 1] as readonly number[];
        for (let k = 0; k < comps; k++) {
          let sum = 0;
          for (const q of corners) sum += layer.data[q * comps + k] as number;
          out[c * comps + k] = sum / corners.length;
        }
      });
      layers.set(name, { def: layer.def, data: out });
    } else if (layer.def.domain === 'face') {
      const out = new Ctor(faces.length * comps);
      faces.forEach((face, f) => {
        for (let k = 0; k < comps; k++) out[f * comps + k] = layer.data[face.face * comps + k] as number;
      });
      layers.set(name, { def: layer.def, data: out });
    }
  }
  return {
    counts: { points: P2, edges: edgeVerts.length / 2, faces: faces.length, corners: C2 },
    position,
    edgeVerts: Uint32Array.from(edgeVerts),
    edgeFlags: Uint8Array.from(edgeFlags),
    cornerVert,
    cornerNext,
    faceCorner,
    faceMaterial,
    faceFlags: new Uint8Array(faces.length),
    layers,
  };
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as Json)
      .sort()
      .map((key) => [key, sortKeys((value as Json)[key])]),
  );
}

/**
 * JSON values of the original that changed in a surgeon output, outside the allowed diffs (E2E-MOD-12): the edited
 * meshes' `primitives`, appended accessors/bufferViews, buffers[0].byteLength, `asset.extras` (marker and clip
 * metadata), `asset.generator`, the extension lists and (with clips) `animations`.
 */
export function preservationProblems(source: GlbContainer, out: GlbContainer, meshes: readonly number[]): string[] {
  const before = source.json as Json;
  const after = out.json as Json;
  const problems: string[] = [];
  for (const [key, value] of Object.entries(before)) {
    if (key === 'extensionsUsed' || key === 'extensionsRequired' || key === 'animations') continue;
    if (key === 'asset') {
      const { extras: _a, generator: _g, ...rest } = value as Json;
      const { extras: _b, generator: _h, ...restAfter } = after[key] as Json;
      if (!jsonEqual(rest, restAfter)) problems.push('asset');
    } else if (key === 'buffers') {
      const [b0, ...others] = value as Json[];
      const [a0, ...othersAfter] = after[key] as Json[];
      const { byteLength: _x, ...b0rest } = b0 ?? {};
      const { byteLength: _y, ...a0rest } = a0 ?? {};
      if (!jsonEqual(b0rest, a0rest) || !jsonEqual(others, othersAfter)) problems.push('buffers');
    } else if (key === 'meshes') {
      (value as Json[]).forEach((mesh, i) => {
        const other = (after[key] as Json[])[i] as Json;
        if (meshes.includes(i)) {
          const { primitives: _p, ...rest } = mesh;
          const { primitives: _q, ...restAfter } = other;
          if (!jsonEqual(rest, restAfter)) problems.push(`meshes[${i}]`);
        } else if (!jsonEqual(mesh, other)) {
          problems.push(`meshes[${i}]`);
        }
      });
    } else if (Array.isArray(value)) {
      value.forEach((entry, i) => {
        if (!jsonEqual(entry, (after[key] as unknown[])[i])) problems.push(`${key}[${i}]`);
      });
    } else if (!jsonEqual(value, after[key])) {
      problems.push(key);
    }
  }
  return problems;
}

/** The BIN of `out` starts with the BIN of `source` up to its declared length. */
export function binPrefixKept(source: GlbContainer, out: GlbContainer): boolean {
  const length = ((source.json['buffers'] as Json[])[0]?.['byteLength'] as number) ?? 0;
  const a = source.bin?.subarray(0, length) ?? new Uint8Array(0);
  const b = out.bin?.subarray(0, length) ?? new Uint8Array(0);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Dense float/integer accessor reads of a parsed GLB (the surgeon's and author writer's outputs are tightly packed). */
export class AccessorReader {
  constructor(private readonly glb: GlbContainer) {}

  count(index: number): number {
    return ((this.glb.json['accessors'] as Json[])[index]?.['count'] as number) ?? 0;
  }

  floats(index: number): Float32Array {
    const accessor = (this.glb.json['accessors'] as Json[])[index] as Json;
    const view = (this.glb.json['bufferViews'] as Json[])[accessor['bufferView'] as number] as Json;
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor['type'] as 'SCALAR'] ?? 1;
    const offset = ((view['byteOffset'] as number) ?? 0) + ((accessor['byteOffset'] as number) ?? 0);
    const n = (accessor['count'] as number) * comps;
    const bin = this.glb.bin ?? new Uint8Array(0);
    if (accessor['componentType'] !== 5126) throw new Error(`accessor ${index} is not float`);
    return new Float32Array(bin.buffer.slice(bin.byteOffset + offset, bin.byteOffset + offset + 4 * n));
  }
}
