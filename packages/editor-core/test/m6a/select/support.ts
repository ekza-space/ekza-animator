// Shared helpers of B10's editor-core tests: a kernel app in the Model workspace with a memory blob store, meshes
// written as whole revisions through the runtime registry, and a hand-made X-mirror symmetry map.
import type { MeshId } from '@ekza-animator/doc';
import { makeTestMesh } from '@ekza-animator/doc/testing';
import { type MeshData, type PrimitiveKind, primitive, type SymmetryMap } from '@ekza-animator/mesh-core';
import { vi } from 'vitest';
import { createMemoryBlobStore, type EditorApp, loadMeshKernel, provideModelPointer } from '../../../src';
import { createFakeServices } from '../../../src/testing';
import { kernelApp } from '../../kernel/support';

/** A kernel app with the built-ins, a memory blob store and the kernel loaded, switched to Model. */
export async function modelApp(): Promise<EditorApp> {
  await loadMeshKernel();
  const app = kernelApp({
    options: { services: { ...createFakeServices(), blobs: createMemoryBlobStore() }, builtins: true },
  });
  const result = await app.run('workspace.set', { workspace: 'model' });
  if (result.status !== 'finished') throw new Error(`workspace.set: ${JSON.stringify(result)}`);
  return app;
}

/** Writes a mesh record with a primitive revision (reference kernel: cube, plane, cylinder). */
export function addMesh(
  app: EditorApp,
  id: string,
  kind: Extract<PrimitiveKind, 'cube' | 'plane' | 'cylinder'> = 'cube',
  params: Readonly<Record<string, number>> = {},
  fields: Parameters<typeof makeTestMesh>[1] = {},
): MeshId {
  const data = primitive(kind, params);
  app.store.transact({ label: 'Create' }, (tx) => {
    tx.put('meshes', makeTestMesh(id, { name: id, ...fields }));
    app.meshes.writeData(tx, id as MeshId, data);
  });
  return id as MeshId;
}

/** Writes a new whole revision for a mesh (one undoable transaction). */
export function writeRevision(app: EditorApp, id: MeshId, data: MeshData): void {
  app.store.transact({ label: 'Edit' }, (tx) => {
    app.meshes.writeData(tx, id, data);
  });
}

/** Selects objects (session only). */
export function selectObjects(app: EditorApp, objects: readonly string[]): void {
  app.session.setState({ selection: { ...app.session.getState().selection, objects: objects as never } });
}

/** Installs a pointer probe: the mesh under the pointer and the key being dispatched. */
export function probe(app: EditorApp, at: { mesh?: MeshId | null; press?: MeshId | null; key?: string | null }): void {
  provideModelPointer(app, {
    meshAt: (_pane, where) => (where === 'press' ? (at.press ?? null) : (at.mesh ?? null)),
    lastKey: () => at.key ?? null,
  });
}

/** A mirror map across x = 0 built from positions (vertex, edge and face partners; −1 without one). */
export function mirrorMapX(data: MeshData): SymmetryMap {
  const p = data.position;
  const n = data.counts.points;
  const vertex = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (
        Math.abs((p[3 * i] as number) + (p[3 * j] as number)) < 1e-6 &&
        Math.abs((p[3 * i + 1] as number) - (p[3 * j + 1] as number)) < 1e-6 &&
        Math.abs((p[3 * i + 2] as number) - (p[3 * j + 2] as number)) < 1e-6
      ) {
        vertex[i] = j;
      }
    }
  }
  const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const edges = new Map<string, number>();
  for (let e = 0; e < data.counts.edges; e++)
    edges.set(edgeKey(data.edgeVerts[2 * e] as number, data.edgeVerts[2 * e + 1] as number), e);
  const edge = new Int32Array(data.counts.edges).fill(-1);
  const edgeSelf = new Uint8Array(data.counts.edges);
  for (let e = 0; e < data.counts.edges; e++) {
    const a = vertex[data.edgeVerts[2 * e] as number] as number;
    const b = vertex[data.edgeVerts[2 * e + 1] as number] as number;
    if (a < 0 || b < 0) continue;
    edge[e] = edges.get(edgeKey(a, b)) ?? -1;
    if (edge[e] === e) edgeSelf[e] = 2;
  }
  const faceVerts = (f: number): number[] => {
    const out: number[] = [];
    const first = data.faceCorner[f] as number;
    let c = first;
    do {
      out.push(data.cornerVert[c] as number);
      c = data.cornerNext[c] as number;
    } while (c !== first);
    return out.sort((x, y) => x - y);
  };
  const faces = new Map<string, number>();
  for (let f = 0; f < data.counts.faces; f++) faces.set(faceVerts(f).join(','), f);
  const face = new Int32Array(data.counts.faces).fill(-1);
  for (let f = 0; f < data.counts.faces; f++) {
    const mirrored = faceVerts(f).map((v) => vertex[v] as number);
    if (mirrored.some((v) => v < 0)) continue;
    face[f] = faces.get(mirrored.sort((x, y) => x - y).join(',')) ?? -1;
  }
  return {
    axis: 'x',
    space: 'object',
    plane: 0,
    tolerance: 0.001,
    vertex,
    edge,
    edgeReversed: new Uint8Array(data.counts.edges),
    edgeSelf,
    face,
    unmatched: [...vertex].filter((v) => v < 0).length,
  };
}

/** Makes a mesh's runtime report `map` as its symmetry map (B7 builds it from the session settings). */
export function withSymmetry(app: EditorApp, id: MeshId, map: SymmetryMap): void {
  const runtime = app.meshes.get(id);
  if (runtime === undefined) throw new Error(`no runtime ${id}`);
  vi.spyOn(runtime, 'symmetry').mockReturnValue(map);
}

/** The model() view of a mesh's visible selection of `kind`, ascending. */
export function selected(app: EditorApp, id: MeshId, kind: 'vertex' | 'edge' | 'face'): number[] {
  const sel = app.components.get(id, kind);
  return [...(kind === 'vertex' ? sel.verts : kind === 'edge' ? sel.edges : sel.faces).toArray()];
}
