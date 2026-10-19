// `MeshData` from a face list (M6A-SPEC §4.3 stored form): corners in face order, each face's corners consecutive,
// edges in first-use order with the endpoints of their first use (so t = 0 is the first corner that walks the edge).
// Used by the primitives, the testing fixtures and tests.
import { kernelError } from '../kernel';
import { defaultLayerData, domainCount, type LayerArray, storedValue } from '../layers/arrays';
import type { LayerDef, MeshData } from '../types';

export interface MeshBuild {
  /** 3P coordinates. */
  readonly positions: ArrayLike<number>;
  /** Vertex indices per face, in winding order (CCW seen from the front). */
  readonly faces: readonly (readonly number[])[];
  /** Flags of every edge (EDGE_HARD for faceted meshes); default 0. */
  readonly edgeFlags?: number;
  readonly faceMaterial?: readonly number[];
  readonly faceFlags?: readonly number[];
  /** Layers added with their default values (`data` overrides them; length count × comps). */
  readonly layers?: readonly { readonly def: LayerDef; readonly data?: ArrayLike<number> }[];
}

/** The unordered vertex pair of an edge as one number (P < 2^26 keeps it exact). */
export function pairKey(a: number, b: number, points: number): number {
  return a < b ? a * points + b : b * points + a;
}

export function buildMeshData(build: MeshBuild): MeshData {
  const points = Math.floor(build.positions.length / 3);
  if (points * 3 !== build.positions.length) throw kernelError('invalid-mesh', 'buildMeshData: positions length % 3');
  const position = new Float32Array(points * 3);
  for (let i = 0; i < position.length; i++) position[i] = Math.fround(build.positions[i] as number);
  let corners = 0;
  for (const face of build.faces) corners += face.length;
  const cornerVert = new Uint32Array(corners);
  const cornerNext = new Uint32Array(corners);
  const faceCorner = new Uint32Array(build.faces.length);
  const edgeIndex = new Map<number, number>();
  const edges: number[] = [];
  let c = 0;
  build.faces.forEach((face, f) => {
    if (face.length < 3) throw kernelError('invalid-mesh', `buildMeshData: face ${f} has ${face.length} corners`);
    faceCorner[f] = c;
    for (let i = 0; i < face.length; i++) {
      const a = face[i] as number;
      const b = face[(i + 1) % face.length] as number;
      if (!Number.isInteger(a) || a < 0 || a >= points) throw kernelError('invalid-mesh', `buildMeshData: vertex ${a}`);
      cornerVert[c + i] = a;
      cornerNext[c + i] = c + ((i + 1) % face.length);
      const key = pairKey(a, b, points);
      if (!edgeIndex.has(key)) {
        edgeIndex.set(key, edges.length / 2);
        edges.push(a, b);
      }
    }
    c += face.length;
  });
  const counts = Object.freeze({ points, edges: edges.length / 2, faces: build.faces.length, corners });
  const edgeFlags = new Uint8Array(counts.edges).fill(build.edgeFlags ?? 0);
  const faceMaterial = new Uint16Array(counts.faces);
  const faceFlags = new Uint8Array(counts.faces);
  if (build.faceMaterial !== undefined) faceMaterial.set(build.faceMaterial);
  if (build.faceFlags !== undefined) faceFlags.set(build.faceFlags);
  const layers = new Map<string, { readonly def: LayerDef; readonly data: LayerArray }>();
  for (const layer of build.layers ?? []) {
    const data = defaultLayerData(layer.def, domainCount(counts, layer.def.domain));
    if (layer.data !== undefined) {
      const values = layer.data;
      for (let i = 0; i < Math.min(values.length, data.length); i++) {
        data[i] = storedValue(layer.def.type, values[i] as number);
      }
    }
    layers.set(layer.def.name, { def: layer.def, data });
  }
  return {
    counts,
    position,
    edgeVerts: Uint32Array.from(edges),
    edgeFlags,
    cornerVert,
    cornerNext,
    faceCorner,
    faceMaterial,
    faceFlags,
    layers,
  };
}

/** The empty mesh (0/0/0/0, no layers). */
export function emptyMeshData(): MeshData {
  return buildMeshData({ positions: [], faces: [] });
}
