// C2 operator tests (M6B-SPEC §0.4.2, §5.2–§5.7): a mesh test app with the Cube Lad as a scene mesh (built from the
// truth boxes of `fixtures/models/cube-lad-truth.json`, §0.7), and a stand-in for C1's `char.fromModel` (registered
// before the rig-workspace chunk, which keeps an id that is already registered) so the composition into
// `skel.template.create` / `skel.quickRig.commit` runs before C1 merges: it creates the model character, its empty
// skeleton record and rig record and adopts the scene meshes (world placement frozen into a new revision).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mat4Compose, xfIdentity } from '@ekza-studio/anim-core';
import { type CharacterRecord, derivedId, type MeshId, type MeshRecord, type MeshRef, type Tx } from '@ekza-studio/doc';
import { makeTestRig } from '@ekza-studio/doc/testing';
import type { MeshData } from '@ekza-studio/mesh-core';
import { buildMeshData } from '@ekza-studio/mesh-core/testing';
import type { QuickRigMarker, QuickRigMarkers } from '@ekza-studio/rig';
import { type EditorApp, kernelMeshes, type OperatorDef, worldPlacement } from '../../../src';
import { createMesh, type MeshTestApp, meshTestApp } from '../../mesh/support';

type V3 = readonly [number, number, number];

const TRUTH = fileURLToPath(new URL('../../../../../fixtures/models/cube-lad-truth.json', import.meta.url));

export interface CubeLadTruth {
  readonly height: number;
  readonly boxes: readonly { readonly name: string; readonly center: V3; readonly size: V3 }[];
  readonly markers: Readonly<Record<QuickRigMarker, V3>>;
  readonly joints: Readonly<Record<string, { readonly position: V3 }>>;
}

export function cubeLadTruth(): CubeLadTruth {
  return JSON.parse(readFileSync(TRUTH, 'utf8')) as CubeLadTruth;
}

/** The Cube Lad as one mesh: 16 boxes (8 points, 6 outward quads each), T-posed, facing +Z, on y = 0. */
export function cubeLadData(): MeshData {
  const positions: number[] = [];
  const faces: number[][] = [];
  for (const box of cubeLadTruth().boxes) {
    const base = positions.length / 3;
    const [hx, hy, hz] = [box.size[0] / 2, box.size[1] / 2, box.size[2] / 2];
    for (const z of [-hz, hz]) {
      for (const [x, y] of [
        [-hx, -hy],
        [hx, -hy],
        [hx, hy],
        [-hx, hy],
      ] as const) {
        positions.push(box.center[0] + x, box.center[1] + y, box.center[2] + z);
      }
    }
    for (const quad of [
      [4, 5, 6, 7],
      [1, 0, 3, 2],
      [5, 1, 2, 6],
      [0, 4, 7, 3],
      [7, 6, 2, 3],
      [0, 1, 5, 4],
    ]) {
      faces.push(quad.map((i) => base + i));
    }
  }
  return buildMeshData({ positions, faces });
}

/** The fake `char.fromModel` (C1's contract: `{objects, name}` → `{character, skeleton}`, one transaction). */
export function fakeFromModel(): OperatorDef<unknown, unknown, unknown> {
  return {
    id: 'char.fromModel',
    label: 'Character from Selection',
    category: 'char',
    scope: 'rig',
    flags: { undo: true },
    extraArgs: ['objects', 'name'],
    prepare(ctx, args) {
      // Freeze each source's world placement into a new revision (the C1 adoption rule, §5.1).
      const objects = (args as { objects: readonly string[] }).objects;
      const runtimes = kernelMeshes(ctx.app);
      const out: { source: MeshId; ref: MeshRef | null }[] = [];
      for (const id of objects) {
        const record = ctx.app.store.get('meshes', id as MeshId);
        if (record === undefined) continue;
        const world = worldPlacement(ctx.app.store, record);
        const data = runtimes?.get(record.id)?.data() ?? null;
        const identity = JSON.stringify(world) === JSON.stringify(xfIdentity());
        if (identity || data === null) {
          out.push({ source: record.id, ref: null });
          continue;
        }
        const m = mat4Compose(world);
        const P = data.position;
        const position = new Float32Array(P.length);
        for (let i = 0; i < P.length; i += 3) {
          for (let k = 0; k < 3; k++) {
            position[i + k] = Math.fround(
              (m[k] as number) * (P[i] as number) +
                (m[4 + k] as number) * (P[i + 1] as number) +
                (m[8 + k] as number) * (P[i + 2] as number) +
                (m[12 + k] as number),
            );
          }
        }
        out.push({ source: record.id, ref: runtimes?.storeRevision({ ...data, position }, null, []) ?? null });
      }
      return out;
    },
    apply(ctx, _args, prepared) {
      const tx = ctx.tx as Tx;
      const sources = prepared as { source: MeshId; ref: MeshRef | null }[];
      const first = sources[0]?.source as string;
      const character = derivedId('character', 'char.fromModel', [first], 'test', 0);
      const skeleton = derivedId('skeleton', 'char.fromModel', [first], 'test', 1);
      const rig = derivedId('rig', 'char.fromModel', [first], 'test', 2);
      const record: CharacterRecord = {
        id: character,
        name: 'Cube Lad',
        asset: null,
        source: { kind: 'model', skeleton },
        format: 'vrm1',
        rig,
        placement: xfIdentity(),
        order: 'a0',
        deleted: null,
        vrm: null,
      };
      tx.put('characters', record);
      tx.put('skeletons', {
        id: skeleton,
        character,
        template: 'vrm-humanoid',
        templateVersion: '1.0.0',
        preset: 'custom',
        symmetry: true,
        deleted: null,
      });
      tx.put('rigs', makeTestRig(rig, character));
      for (const { source, ref } of sources) {
        const mesh = tx.get('meshes', source) as MeshRecord;
        const adopted = derivedId('mesh', 'char.adopt', [character, source], '', 0);
        tx.put('meshes', {
          ...mesh,
          id: adopted,
          owner: { character },
          parent: null,
          placement: xfIdentity(),
          generator: null,
          data: ref ?? mesh.data,
        });
        tx.softDelete('meshes', source);
      }
      return { character, skeleton };
    },
  };
}

export interface RigTestApp extends MeshTestApp {
  readonly lad: MeshId;
}

/** A mesh test app with the fake `char.fromModel`, the rig chunk loaded and the Cube Lad scene mesh. */
export async function rigTestApp(fields: Partial<Omit<MeshRecord, 'id'>> = {}): Promise<RigTestApp> {
  const t = await meshTestApp();
  t.app.contribute({ kind: 'operator', def: fakeFromModel() });
  await t.app.rig.load();
  const lad = createMesh(t, 'msh_cubeLad00000000', cubeLadData(), { name: 'Cube Lad', ...fields });
  return { ...t, lad };
}

export function charactersOf(app: EditorApp): CharacterRecord[] {
  return app.store.list('characters').filter((c) => c.source.kind === 'model');
}

/** The Cube Lad's live mesh ids (scene or adopted). */
export function ladMeshes(app: EditorApp): MeshId[] {
  return app.store.list('meshes').map((m) => m.id);
}

export function truthMarkers(): QuickRigMarkers {
  return cubeLadTruth().markers;
}
