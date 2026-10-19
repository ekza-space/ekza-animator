// M6a test API, B7 group (M6A-SPEC §4.8): mesh records, revisions and derived data through the kernel, and the blob
// store. B0a: `meshes`, `meshInfo`, `meshNormals` (the reference kernel) and `blobs` are kernel-level and work; the
// others throw until B7 lands them.
import type { MeshId, MeshRecord } from '@ekza-animator/doc';
import { assetMeshRows, meshKernel } from '@ekza-animator/editor-core';
import type { MeshData } from '@ekza-animator/mesh-core';
import type { EkzaAnimatorTestApi } from '../types';
import { type M6aTestApiContext, notImplemented } from './support';

export type MeshRuntimeDocTestApi = Pick<
  EkzaAnimatorTestApi,
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

export function meshRuntimeDocTestApi(ctx: M6aTestApiContext): MeshRuntimeDocTestApi {
  const { app } = ctx.shell;
  const ownerOf = (record: MeshRecord): string =>
    'character' in record.owner ? `char:${record.owner.character}` : 'scene';
  const ready = (mesh: string): { readonly record: MeshRecord; readonly data: MeshData } | null => {
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
  return {
    meshes() {
      ctx.sync();
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
    meshPositions: () => notImplemented('B7', 'meshPositions'),
    meshFaces: () => notImplemented('B7', 'meshFaces'),
    meshEdges: () => notImplemented('B7', 'meshEdges'),
    meshLayer: () => notImplemented('B7', 'meshLayer'),
    shading: () => notImplemented('B7', 'shading'),
    blobs() {
      return {
        resident: app.blobs.ids().length,
        residentBytes: app.blobs.residentBytes,
        historyBytes: 0, // B7: bytes the undo history keeps alive (the budget, §5.20)
        journalBytes: app.meshes.journalBytes,
      };
    },
  };
}
