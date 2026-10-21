// M6a test API, B7 group (M6A-SPEC §4.8): mesh records, revisions and derived data through the kernel, and the blob
// store. `meshes()` lists the records plus one virtual row per loaded character glTF mesh without a record (badge
// 'asset', its derived MeshId, §5.21); counts, stats and normals come from the runtimes (the kernel's one
// triangulation and normals); positions in mesh-local or world space (the placement through groups, parent meshes and
// the character root).
import { quatRotateVec3 } from '@ekza-studio/anim-core';
import type { MeshId, MeshRecord } from '@ekza-studio/doc';
import { assetMeshRows, attachMeshes, meshKernel, worldPlacement } from '@ekza-studio/editor-core';
import type { MeshData } from '@ekza-studio/mesh-core';
import type { EkzaStudioTestApi } from '../types';
import type { M6aTestApiContext } from './support';

export type MeshRuntimeDocTestApi = Pick<
  EkzaStudioTestApi,
  | 'meshes'
  | 'meshNormals'
  | 'meshInfo'
  | 'meshPositions'
  | 'meshFaces'
  | 'meshEdges'
  | 'meshLayer'
  | 'shading'
  | 'blobs'
>;

const EDGE_HARD = 1;
const EDGE_SEAM = 2;

/** Rows of a Float32Array of `n` vectors with `k` components. */
function rows(values: ArrayLike<number>, k: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + k <= values.length; i += k)
    out.push(Array.from({ length: k }, (_, j) => values[i + j] as number));
  return out;
}

function boundsOf(data: MeshData): [number[], number[]] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const p = data.position;
  for (let i = 0; i < data.counts.points; i++) {
    for (let k = 0; k < 3; k++) {
      const v = p[3 * i + k] as number;
      if (v < (min[k] as number)) min[k] = v;
      if (v > (max[k] as number)) max[k] = v;
    }
  }
  return data.counts.points === 0
    ? [
        [0, 0, 0],
        [0, 0, 0],
      ]
    : [min, max];
}

/** Faces as vertex index lists in winding order. */
function facesOf(data: MeshData): number[][] {
  const out: number[][] = [];
  for (let f = 0; f < data.counts.faces; f++) {
    const first = data.faceCorner[f] as number;
    const face: number[] = [];
    let c = first;
    for (let guard = 0; guard <= data.counts.corners; guard++) {
      face.push(data.cornerVert[c] as number);
      c = data.cornerNext[c] as number;
      if (c === first) break;
    }
    out.push(face);
  }
  return out;
}

/** Number of faces using each edge (corners whose side is the edge). */
function edgeFaceCounts(data: MeshData): Int32Array {
  const P = data.counts.points;
  const index = new Map<number, number>();
  for (let e = 0; e < data.counts.edges; e++) {
    const a = data.edgeVerts[2 * e] as number;
    const b = data.edgeVerts[2 * e + 1] as number;
    index.set(Math.min(a, b) * P + Math.max(a, b), e);
  }
  const counts = new Int32Array(data.counts.edges);
  for (let c = 0; c < data.counts.corners; c++) {
    const a = data.cornerVert[c] as number;
    const b = data.cornerVert[data.cornerNext[c] as number] as number;
    const e = index.get(Math.min(a, b) * P + Math.max(a, b));
    if (e !== undefined) counts[e] = (counts[e] as number) + 1;
  }
  return counts;
}

export function meshRuntimeDocTestApi(ctx: M6aTestApiContext): MeshRuntimeDocTestApi {
  const { app } = ctx.shell;
  const ownerOf = (record: MeshRecord): string =>
    'character' in record.owner ? `char:${record.owner.character}` : 'scene';
  const ready = (mesh: string): { readonly record: MeshRecord; readonly data: MeshData } | null => {
    attachMeshes(app);
    const record = app.store.get('meshes', mesh as MeshId);
    const data = app.meshes.get(mesh as MeshId)?.data() ?? null;
    return record === undefined || data === null ? null : { record, data };
  };
  const counts = (mesh: string, data: MeshData) => ({
    v: data.counts.points,
    e: data.counts.edges,
    f: data.counts.faces,
    c: data.counts.corners,
    tris: (app.meshes.get(mesh as MeshId)?.triangulation().tris.length ?? 0) / 3,
  });
  const require = (mesh: string, fn: string): { readonly record: MeshRecord; readonly data: MeshData } => {
    const found = ready(mesh);
    if (found === null) throw new Error(`${fn}: mesh ${mesh} has no ready runtime`);
    return found;
  };
  return {
    meshes() {
      ctx.sync();
      attachMeshes(app);
      // B8 (§5.21): one virtual 'asset' row per loaded character glTF mesh without a record, after the records.
      const virtual = assetMeshRows(app).map((row) => ({
        id: row.id,
        name: row.name,
        owner: `char:${row.character}`,
        parent: null,
        badge: 'asset' as const,
        manifest: null,
        rev: 0,
        faceted: false,
        generator: null,
        palette: null,
        counts: null,
        runtime: 'none',
      }));
      const records = app.store.list('meshes').map((record) => {
        const runtime = app.meshes.get(record.id);
        const data = runtime?.data() ?? null;
        return {
          id: record.id,
          name: record.name,
          owner: ownerOf(record),
          parent: record.parent,
          badge: record.generator !== null ? ('prim' as const) : ('edit' as const),
          manifest: record.data?.manifest ?? null,
          rev: record.data?.rev ?? 0,
          faceted: record.faceted,
          generator: record.generator?.kind ?? null,
          palette: record.palette,
          counts: data === null ? null : counts(record.id, data),
          runtime: runtime?.state ?? 'none',
        };
      });
      return [...records, ...virtual];
    },
    meshNormals(mesh) {
      ctx.sync();
      const runtime = app.meshes.get(mesh as MeshId);
      if (runtime === undefined || runtime.data() === null) return null;
      const normals = runtime.normals();
      return { face: rows(normals.face, 3), corner: rows(normals.corner, 3) };
    },
    meshInfo(mesh) {
      ctx.sync();
      const kernel = meshKernel();
      const found = ready(mesh);
      if (kernel === null || found === null || found.record.data === null) return null;
      const stats = kernel.topologyStats(found.data);
      return {
        counts: counts(mesh, found.data),
        stats: {
          shells: stats.shells,
          boundaryLoops: stats.boundaryLoops,
          euler: stats.euler,
          nonManifoldEdges: stats.nonManifoldEdges,
          nonManifoldVerts: stats.nonManifoldVerts,
        },
        problems: kernel.validateMesh(found.data).length,
        bounds: boundsOf(found.data),
        manifest: found.record.data.manifest,
        layers: [...found.data.layers.keys()],
      };
    },
    meshPositions(mesh, verts, space = 'local') {
      ctx.sync();
      const { record, data } = require(mesh, 'meshPositions');
      const all = verts ?? Array.from({ length: data.counts.points }, (_, i) => i);
      const world = space === 'world' ? worldPlacement(app.store, record) : null;
      return all.map((v) => {
        const p: [number, number, number] = [
          data.position[3 * v] as number,
          data.position[3 * v + 1] as number,
          data.position[3 * v + 2] as number,
        ];
        if (world === null) return p;
        const scaled: [number, number, number] = [p[0] * world.s[0], p[1] * world.s[1], p[2] * world.s[2]];
        const r = quatRotateVec3(world.q, scaled, [0, 0, 0]);
        return [r[0] + world.t[0], r[1] + world.t[1], r[2] + world.t[2]];
      });
    },
    meshFaces(mesh) {
      ctx.sync();
      return facesOf(require(mesh, 'meshFaces').data);
    },
    meshEdges(mesh) {
      ctx.sync();
      const { data } = require(mesh, 'meshEdges');
      const faces = edgeFaceCounts(data);
      return Array.from({ length: data.counts.edges }, (_, e) => {
        const flags = data.edgeFlags[e] as number;
        return {
          v: [data.edgeVerts[2 * e] as number, data.edgeVerts[2 * e + 1] as number] as [number, number],
          hard: (flags & EDGE_HARD) !== 0,
          seam: (flags & EDGE_SEAM) !== 0,
          faces: faces[e] as number,
        };
      });
    },
    meshLayer(mesh, layer, indices) {
      ctx.sync();
      const { data } = require(mesh, 'meshLayer');
      const found = data.layers.get(layer);
      if (found === undefined) return [];
      const all = rows(found.data, found.def.comps);
      return indices === undefined ? all : indices.map((i) => all[i] ?? []);
    },
    shading(mesh) {
      ctx.sync();
      const { data } = require(mesh, 'shading');
      const faces = edgeFaceCounts(data);
      let hardEdges = 0;
      let softEdges = 0;
      let borderEdges = 0;
      for (let e = 0; e < data.counts.edges; e++) {
        if ((faces[e] as number) < 2) borderEdges++;
        else if (((data.edgeFlags[e] as number) & EDGE_HARD) !== 0) hardEdges++;
        else softEdges++;
      }
      return { hardEdges, softEdges, borderEdges };
    },
    blobs() {
      const meshes = attachMeshes(app);
      return {
        resident: app.blobs.ids().length,
        residentBytes: app.blobs.residentBytes,
        historyBytes: meshes?.historyBytes ?? 0,
        journalBytes: app.meshes.journalBytes,
      };
    },
  };
}
