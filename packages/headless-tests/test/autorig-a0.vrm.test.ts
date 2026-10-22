// AUTORIG-SPEC §10 A0 gates (6) and (7) (headless, the production kernel with glTF-Validator and vrm-validator): an
// A-posed model is fitted and bound in its own pose, straightened (`skel.pose.applyAsRest {pose: 'tStance'}`) and
// exported for OMOBA (`ekza/space-avatar-v1`, VRM 1.0):
// - A-posed Polybot (`polybot-unskinned.glb`, the A-pose truth markers): every `vrm.*` lint clean, both validators 0
//   errors, the read-back humanoid's upper arm → hand within 5° of ±X and lower leg → foot within 5° of −Y; written to
//   `test-results/autorig-a0/polybot-apose.vrm` for the local OMOBA validator (`node tooling/omoba-validate.mjs …`);
// - the 35° Cube Lad (E2E-QR-02's synthetic A-pose, the One-Click guess): `skel.tpose` before, gone after, exports clean.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { CharacterId, MeshId, SkeletonId } from '@ekza-studio/doc';
import { attachMeshes, type EditorApp, loadMeshKernel, quickRigCommitArgs } from '@ekza-studio/editor-core';
import { type ExportArtifact, parseGlb } from '@ekza-studio/io';
import { DEFAULT_FLEXION, markersFromJoints, type QuickRigMarkers } from '@ekza-studio/rig';
import { beforeAll, describe, expect, it } from 'vitest';
import { exportCharacter, settled, vrmErrors } from './m6b.writer.support';
import { realApp, runOk } from './ops.support';

type V3 = readonly [number, number, number];
type Json = Record<string, unknown>;
const SPACE = 'ekza/space-avatar-v1';
const DEG = Math.PI / 180;
const OUT = new URL('../../../test-results/autorig-a0/', import.meta.url);
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../fixtures/models/${name}`, import.meta.url)));

beforeAll(async () => {
  await loadMeshKernel();
});

const codes = (app: EditorApp, character: CharacterId): string[] =>
  app.rig.validation.rows(character, SPACE).map((row) => row.code);

/** A fresh app in Rig & Skin with mesh runtimes. */
async function rigApp(): Promise<EditorApp> {
  const { app } = realApp();
  attachMeshes(app);
  await app.rig.load();
  await runOk(app, 'workspace.set', { workspace: 'rig' });
  return app;
}

/** Create Skeleton → Bind Skin → the `skel.tpose` row → Straighten to T-Pose → meta, thumbnail, the Space export. */
async function straightenAndExport(
  app: EditorApp,
  args: unknown,
): Promise<{ artifact: ExportArtifact; before: string[] }> {
  const made = (await runOk(app, 'skel.quickRig.commit', args)) as { character: CharacterId; skeleton: SkeletonId };
  await runOk(app, 'skin.bind', {});
  await settled(app);
  const before = codes(app, made.character);
  await runOk(app, 'skel.pose.applyAsRest', { character: made.character, pose: 'tStance' });
  expect(app.history.peekUndo()?.label).toBe('Straighten to T-Pose');
  await settled(app);
  await runOk(app, 'char.setVrmMeta', {
    character: made.character,
    patch: { authors: ['Tester'], licensePreset: 'cc0' },
  });
  await runOk(app, 'char.renderThumbnail', { character: made.character });
  await settled(app);
  expect(codes(app, made.character)).not.toContain('skel.tpose');
  const artifact = await exportCharacter(app, { character: made.character, profile: SPACE, format: 'vrm' });
  return { artifact, before };
}

/** World rest positions of the humanoid bones of a VRM 1.0 file (node TRS chains). */
async function humanoidWorlds(bytes: Uint8Array): Promise<Map<string, V3>> {
  const json = (await parseGlb(bytes)).json as unknown as Json;
  const nodes = json['nodes'] as { translation?: number[]; rotation?: number[]; children?: number[] }[];
  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((node, i) => {
    for (const child of node.children ?? []) parent[child] = i;
  });
  const worlds = new Map<number, { t: V3; q: readonly [number, number, number, number] }>();
  const rotate = (q: readonly number[], v: V3): V3 => {
    const [x, y, z, w] = q as [number, number, number, number];
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  };
  const mul = (a: readonly number[], b: readonly number[]): [number, number, number, number] => [
    (a[3] as number) * (b[0] as number) +
      (a[0] as number) * (b[3] as number) +
      (a[1] as number) * (b[2] as number) -
      (a[2] as number) * (b[1] as number),
    (a[3] as number) * (b[1] as number) -
      (a[0] as number) * (b[2] as number) +
      (a[1] as number) * (b[3] as number) +
      (a[2] as number) * (b[0] as number),
    (a[3] as number) * (b[2] as number) +
      (a[0] as number) * (b[1] as number) -
      (a[1] as number) * (b[0] as number) +
      (a[2] as number) * (b[3] as number),
    (a[3] as number) * (b[3] as number) -
      (a[0] as number) * (b[0] as number) -
      (a[1] as number) * (b[1] as number) -
      (a[2] as number) * (b[2] as number),
  ];
  const world = (i: number): { t: V3; q: readonly [number, number, number, number] } => {
    const known = worlds.get(i);
    if (known !== undefined) return known;
    const node = nodes[i] ?? {};
    const t = (node.translation ?? [0, 0, 0]) as unknown as V3;
    const q = (node.rotation ?? [0, 0, 0, 1]) as unknown as [number, number, number, number];
    const p = parent[i] as number;
    const out =
      p === -1
        ? { t, q }
        : (() => {
            const pw = world(p);
            const r = rotate(pw.q, t);
            return { t: [pw.t[0] + r[0], pw.t[1] + r[1], pw.t[2] + r[2]] as V3, q: mul(pw.q, q) };
          })();
    worlds.set(i, out);
    return out;
  };
  const bones = ((json['extensions'] as Json)['VRMC_vrm'] as Json)['humanoid'] as {
    humanBones: Record<string, { node: number }>;
  };
  return new Map(Object.entries(bones.humanBones).map(([name, { node }]) => [name, world(node).t]));
}

const angleTo = (v: V3, axis: V3): number =>
  Math.acos(Math.min(1, (v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2]) / Math.hypot(...v)));
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

describe('A0: A-posed models straighten into OMOBA T-pose VRMs', { timeout: 300_000 }, () => {
  it('A-posed Polybot: vrm.* clean, validators 0 errors, read-back arms along ±X and shins down', async () => {
    const app = await rigApp();
    const { meshes } = (await runOk(app, 'mesh.importStatic', {
      bytes: fixture('polybot-unskinned.glb'),
      name: 'polybot-unskinned.glb',
    })) as { meshes: MeshId[] };
    const truth = JSON.parse(new TextDecoder().decode(fixture('polybot-truth.json'))) as {
      poses: { apose: { humanoid: Record<string, V3> } };
    };
    const data = app.meshes.get(meshes[0] as MeshId)?.data();
    if (data === null || data === undefined) throw new Error('no mesh data');
    let lo = Infinity;
    let hi = -Infinity;
    for (let p = 0; p < data.counts.points; p++) {
      lo = Math.min(lo, data.position[3 * p + 1] as number);
      hi = Math.max(hi, data.position[3 * p + 1] as number);
    }
    const joints = truth.poses.apose.humanoid;
    const head = joints['head'] as V3;
    const markers = markersFromJoints((bone) => {
      const position = joints[bone];
      return position === undefined ? undefined : { position, tail: bone === 'head' ? ([0, hi, head[2]] as V3) : null };
    }, lo) as QuickRigMarkers;
    const { artifact, before } = await straightenAndExport(app, {
      preset: 'standard33',
      markers,
      meshes,
      flexion: DEFAULT_FLEXION,
    });
    expect(before).toContain('skel.tpose');
    expect(artifact.lints.filter((lint) => lint.code.startsWith('vrm.'))).toEqual([]);
    expect(artifact.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    expect(artifact.validation?.errors).toBe(0);
    expect(await vrmErrors(artifact.bytes)).toEqual([]);
    const json = (await parseGlb(artifact.bytes)).json as unknown as Json;
    expect(((json['extensions'] as Json)['VRMC_vrm'] as Json)['specVersion']).toBe('1.0');
    const worlds = await humanoidWorlds(artifact.bytes);
    for (const [side, x] of [
      ['left', 1],
      ['right', -1],
    ] as const) {
      const arm = sub(worlds.get(`${side}Hand`) as V3, worlds.get(`${side}UpperArm`) as V3);
      const shin = sub(worlds.get(`${side}Foot`) as V3, worlds.get(`${side}LowerLeg`) as V3);
      expect(angleTo(arm, [x, 0, 0])).toBeLessThan(5 * DEG);
      expect(angleTo(shin, [0, -1, 0])).toBeLessThan(5 * DEG);
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(new URL('polybot-apose.vrm', OUT), artifact.bytes);
  });

  it('the 35° Cube Lad (One-Click guess): skel.tpose before, clean after, exports with vrm.* clean', async () => {
    const app = await rigApp();
    await runOk(app, 'workspace.set', { workspace: 'model' });
    const truth = JSON.parse(new TextDecoder().decode(fixture('cube-lad-truth.json'))) as {
      boxes: { name: string; center: V3; size: V3 }[];
    };
    const parts: string[] = [];
    for (const box of truth.boxes) {
      const { mesh } = (await runOk(app, 'mesh.create.cube', {
        width: box.size[0],
        height: box.size[1],
        depth: box.size[2],
      })) as { mesh: string };
      const side = box.center[0] < 0 ? -1 : 1;
      let t: number[] = [...box.center];
      let q = [0, 0, 0, 1];
      if (/^(upperArm|forearm|hand)\./.test(box.name)) {
        const a = (side < 0 ? 1 : -1) * 35 * DEG;
        const dx = box.center[0] - side * 0.18;
        const dy = box.center[1] - 1.33;
        t = [
          side * 0.18 + dx * Math.cos(a) - dy * Math.sin(a),
          1.33 + dx * Math.sin(a) + dy * Math.cos(a),
          box.center[2],
        ];
        q = [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
      }
      await runOk(app, 'scene.object.transform', { ids: [mesh], placements: [{ t, q, s: [1, 1, 1] }] });
      parts.push(mesh);
    }
    await runOk(app, 'select.objects', { ids: parts, mode: 'replace' });
    await runOk(app, 'mesh.combine', { pivot: 'origin' });
    await runOk(app, 'workspace.set', { workspace: 'rig' });
    await runOk(app, 'skel.quickRig.start', {});
    const state = app.session.getState().rig.quickRig;
    if (state === null) throw new Error('Quick Rig did not open');
    expect(state.guess?.aPose).toBe(true);
    const { artifact, before } = await straightenAndExport(app, quickRigCommitArgs(state));
    expect(before).toContain('skel.tpose');
    expect(artifact.lints.filter((lint) => lint.code.startsWith('vrm.'))).toEqual([]);
    expect(artifact.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    expect(await vrmErrors(artifact.bytes)).toEqual([]);
  });
});
