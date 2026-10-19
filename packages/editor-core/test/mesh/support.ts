// Shared helpers of the B7 runtime tests (M6A-SPEC §9 B7): an editor app over the real doc store with a memory blob
// store, mesh records stored as revisions, and small kernel ops written against the MeshOp contract that change only
// values (positions, flags, layers) — the B0a reference kernel has no Euler operators, so topology cases wait for
// READY.b1 (ready.ts).
import type { ParamDef, ParamValues } from '@ekza-animator/anim-core';
import { type MeshId, type MeshRecord, type MeshRef, seededIdSource } from '@ekza-animator/doc';
import { makeTestMesh } from '@ekza-animator/doc/testing';
import {
  BUILTIN_LAYERS,
  type ComponentSelection,
  type EditMesh,
  type MeshData,
  type MeshOp,
  type OpContext,
  type OpResult,
  primitive,
  refuse,
  selectionOf,
  writeRevision,
} from '@ekza-animator/mesh-core';
import {
  createEditorApp,
  createMemoryBlobStore,
  type EditorApp,
  type KernelMeshRuntimes,
  loadMeshKernel,
  type MemoryBlobStore,
  type OperatorDef,
} from '../../src';
import { createFakeServices, type FakeServices } from '../../src/testing';

export interface MeshTestApp {
  readonly app: EditorApp;
  readonly meshes: KernelMeshRuntimes;
  readonly blobs: MemoryBlobStore;
  readonly services: FakeServices;
}

/** An editor app (real doc store, built-ins registered) with its memory blob store, kernel loaded and attached. */
export async function meshTestApp(opts?: {
  readonly builtins?: boolean;
  readonly blobs?: MemoryBlobStore;
}): Promise<MeshTestApp> {
  await loadMeshKernel();
  const blobs = opts?.blobs ?? createMemoryBlobStore();
  const services = createFakeServices();
  const app = createEditorApp({
    services: { ...services, blobs },
    idSource: seededIdSource(7),
    builtins: opts?.builtins ?? true,
  });
  app.prefs.setState({ firstRunDone: true });
  const meshes = app.meshes as KernelMeshRuntimes;
  meshes.attach(app);
  return { app, meshes, blobs, services };
}

/** Stores `data` as a revision in `blobs` and returns its ref (rev 1). */
export function storeRevision(blobs: MemoryBlobStore, data: MeshData): MeshRef {
  const out = writeRevision(data);
  for (const [, chunk] of out.newChunks) blobs.put(chunk);
  blobs.put(out.manifestBytes);
  return { manifest: out.manifestId, rev: 1, base: null, joints: [] };
}

/** Creates a scene mesh record holding `data` (one undo step 'Create'). */
export function createMesh(
  t: MeshTestApp,
  id: string,
  data: MeshData = primitive('cube', {}),
  fields: Partial<Omit<MeshRecord, 'id'>> = {},
): MeshId {
  const ref = storeRevision(t.blobs, data);
  t.app.store.transact({ label: 'Create' }, (tx) =>
    tx.put('meshes', makeTestMesh(id, { name: id, data: ref, ...fields })),
  );
  return id as MeshId;
}

export const cube = (): MeshData => primitive('cube', {});

/** The vertices an op reads from a selection: vertex picks, or the vertices of picked faces; all for null. */
export function verticesOf(m: EditMesh, sel: ComponentSelection | null): number[] {
  if (sel === null) return Array.from({ length: m.counts.points }, (_, i) => i);
  const out = new Set<number>();
  if (sel.kind === 'vertex') sel.verts.forEach((v) => out.add(v));
  else if (sel.kind === 'face') {
    sel.faces.forEach((f) => {
      const first = m.faceCorner(f);
      let c = first;
      do {
        out.add(m.cornerVert(c));
        c = m.cornerNext(c);
      } while (c !== first);
    });
  } else {
    sel.edges.forEach((e) => {
      out.add(m.edgeVert(e, 0));
      out.add(m.edgeVert(e, 1));
    });
  }
  return [...out].sort((a, b) => a - b);
}

const DY: ParamDef = {
  name: 'dy',
  label: 'Offset Y',
  kind: 'distance',
  bound: 'value',
  default: 0.1,
  step: 0.01,
  primary: true,
};

/**
 * `mesh.test.offset {dy}`: moves the selected vertices (or every vertex without a selection) by `dy` along Y, with
 * the `adjust` fast path for `dy`. Counts `runs` and `adjusts` so tests can tell the paths apart.
 */
export function offsetOp(opts?: { readonly fastPath?: boolean; readonly id?: string }): MeshOp & {
  runs: number;
  adjusts: number;
} {
  const op = {
    id: (opts?.id ?? 'mesh.test.offset') as `mesh.${string}`,
    label: 'Offset',
    kinds: ['vertex', 'edge', 'face'] as const,
    params: [DY],
    flags: { adjustable: true, repeatable: true, topology: false, manifoldPreserving: true },
    symmetry: 'expand' as const,
    runs: 0,
    adjusts: 0,
    poll: () => true as const,
    run(m: EditMesh, sel: ComponentSelection | null, args: ParamValues, _ctx: OpContext): OpResult {
      op.runs++;
      let dy = typeof args['dy'] === 'number' ? args['dy'] : 0.1;
      const verts = verticesOf(m, sel);
      const move = (by: number): void => {
        for (const v of verts) {
          m.setPosition(
            v,
            m.position[3 * v] as number,
            (m.position[3 * v + 1] as number) + by,
            m.position[3 * v + 2] as number,
          );
        }
      };
      move(dy);
      return {
        selection: sel ?? selectionOf('vertex', verts, m.counts),
        warnings: [],
        resolvedArgs: { dy },
        ...(opts?.fastPath === false
          ? {}
          : {
              adjust: (patch: ParamValues) => {
                const keys = Object.keys(patch);
                if (keys.some((k) => k !== 'dy') || typeof patch['dy'] !== 'number') return false;
                op.adjusts++;
                move(patch['dy'] - dy);
                dy = patch['dy'];
                return true;
              },
            }),
      };
    },
  };
  return op;
}

/** `mesh.test.harden {}`: toggles EDGE_SEAM on every edge (a flags-only op). */
export function seamOp(): MeshOp {
  return {
    id: 'mesh.test.seam',
    label: 'Seam',
    kinds: 'object',
    params: [],
    flags: { adjustable: false, repeatable: true, topology: false, manifoldPreserving: true },
    symmetry: 'none',
    poll: () => true,
    run(m) {
      for (let e = 0; e < m.counts.edges; e++) m.setEdgeFlags(e, m.edgeFlags(e) ^ 2);
      return { selection: selectionOf('edge', [], m.counts), warnings: [], resolvedArgs: {} };
    },
  };
}

/** `mesh.test.paint {slot}`: writes the `paint` layer of every face (adds the layer when missing). */
export function paintOp(): MeshOp {
  return {
    id: 'mesh.test.paint',
    label: 'Paint',
    kinds: 'object',
    params: [{ name: 'slot', label: 'Slot', kind: 'int', bound: 'value', default: 1, min: 0, max: 65534 }],
    flags: { adjustable: true, repeatable: true, topology: false, manifoldPreserving: true },
    symmetry: 'none',
    poll: () => true,
    run(m, _sel, args) {
      const layer = m.layer('paint') ?? m.addLayer(BUILTIN_LAYERS.paint);
      const slot = typeof args['slot'] === 'number' ? args['slot'] : 1;
      for (let f = 0; f < m.counts.faces; f++) layer.set(f, 0, slot);
      return { selection: selectionOf('face', [], m.counts), warnings: [], resolvedArgs: { slot } };
    },
  };
}

/** An op that writes, then refuses (the runtime must abort its log). */
export function refusingOp(): MeshOp {
  return {
    ...offsetOp({ id: 'mesh.test.refuse' }),
    run(m) {
      m.setPosition(0, 9, 9, 9);
      return refuse('test.refused', 'This op always refuses');
    },
  };
}

/** An op that writes NaN (invalid under the kernel debug switch: `end()` throws invalid-mesh and reverts). */
export function invalidOp(): MeshOp {
  return {
    ...offsetOp({ id: 'mesh.test.invalid' }),
    run(m) {
      m.setPosition(0, Number.NaN, 0, 0);
      return { selection: selectionOf('vertex', [], m.counts), warnings: [], resolvedArgs: {} };
    },
  };
}

/**
 * A registry operator around a test op (what `meshOperator` does for kernel ops): one transaction, `commitOp` on
 * the given meshes with the given selection.
 */
export function testOperator(
  op: MeshOp,
  opts?: { readonly selection?: (app: EditorApp) => ReadonlyMap<MeshId, ComponentSelection> | undefined },
): OperatorDef<unknown, unknown, void> {
  return {
    id: op.id,
    label: op.label,
    category: 'mesh',
    scope: 'model',
    flags: { undo: true, adjustable: true, repeatable: true },
    params: op.params,
    extraArgs: ['meshes', 'kind'],
    apply(ctx, raw) {
      const args = (raw ?? {}) as Record<string, unknown>;
      const meshes = (args['meshes'] ?? []) as MeshId[];
      const { meshes: _m, kind: _k, ...rest } = args;
      const selection = opts?.selection?.(ctx.app);
      return (ctx.app.meshes as KernelMeshRuntimes).commitOp(ctx.tx as never, op, meshes, rest as ParamValues, {
        seed: 'seed',
        kind: (args['kind'] as never) ?? null,
        ...(selection === undefined ? {} : { selection }),
      });
    },
  };
}

/** Positions of a runtime's current content. */
export function positionsOf(t: MeshTestApp, id: MeshId): number[] {
  return [...((t.app.meshes.get(id)?.data()?.position ?? []) as Float32Array)];
}

/** Every blob a ref needs is resident (manifest and chunks). */
export function resident(t: MeshTestApp, ref: MeshRef | null | undefined): boolean {
  if (ref === null || ref === undefined) return true;
  if (!t.blobs.has(ref.manifest)) return false;
  return t.blobs.closure([ref.manifest]).every((id) => t.blobs.has(id));
}

/** Lets microtasks (deferred checks, two-phase verification) run. */
export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
