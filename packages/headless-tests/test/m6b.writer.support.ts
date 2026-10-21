// Shared by the C10 headless tests (M6B-SPEC §5.22; `m6b.writer.*`): a model character made in the app — a generated
// body or Polybot (unskinned, T-pose) adopted by `char.fromModel`, the Standard 33 truth joints, every point bound to
// its two nearest bones, the control rig — and its idle clip, the ready-to-export state, the export and vrm-validator.
import { readFileSync } from 'node:fs';
import {
  type CharacterId,
  type ClipId,
  fractionalIndex,
  type HumanBoneName,
  type JointId,
  type JointRecord,
  type MeshId,
  type SkeletonId,
} from '@ekza-studio/doc';
import { attachMeshes, type EditorApp, type KernelMeshRuntimes } from '@ekza-studio/editor-core';
import type { ExportArtifact } from '@ekza-studio/io';
import { type SkinWeights, withSkin } from '@ekza-studio/mesh-core';
import * as vrmValidator from 'vrm-validator';
import { runOk, setSceneFrame } from './ops.support';

type Json = Record<string, unknown>;
const DEG = Math.PI / 180;

const TRUTH = JSON.parse(
  readFileSync(new URL('../../../fixtures/models/cube-lad-truth.json', import.meta.url), 'utf8'),
) as {
  readonly joints: Readonly<
    Record<string, { readonly position: readonly [number, number, number]; readonly parent: string | null }>
  >;
};

/** The generated body (1.7 m) as a model character with the Standard 33 truth joints, bound to its two nearest bones. */
export async function bodyCharacter(
  a: EditorApp,
  opts: { readonly source?: 'body' | 'polybot'; readonly name?: string } = {},
): Promise<{ character: CharacterId; skeleton: SkeletonId; mesh: MeshId }> {
  const meshes = attachMeshes(a) as KernelMeshRuntimes;
  let body: readonly string[];
  if (opts.source === 'polybot') {
    const imported = (await runOk(a, 'mesh.importStatic', {
      bytes: new Uint8Array(
        readFileSync(new URL('../../../fixtures/models/polybot-unskinned-tpose.glb', import.meta.url)),
      ),
      name: 'polybot.glb',
    })) as { meshes: string[] };
    body = imported.meshes;
  } else {
    await runOk(a, 'mesh.create.template', { template: 'humanoidBody', height: 1.7 });
    body = a.session.getState().selection.objects;
  }
  const made = (await runOk(a, 'char.fromModel', { objects: body, name: opts.name ?? 'Body Lad' })) as {
    character: CharacterId;
    skeleton: SkeletonId;
  };
  const mesh = a.store.query.meshesOfOwner(made.character)[0]?.id as MeshId;
  const data = a.meshes.get(mesh)?.data();
  if (data === null || data === undefined) throw new Error('no body data');
  const joints: JointRecord[] = [];
  let order: string | null = null;
  for (const [key, joint] of Object.entries(TRUTH.joints)) {
    order = fractionalIndex(order, null);
    joints.push({
      id: `jnt_${key}` as JointId,
      skeleton: made.skeleton,
      parent: joint.parent === null ? null : (`jnt_${joint.parent}` as JointId),
      order,
      name: key,
      humanBone: key === 'root' ? null : (key as HumanBoneName),
      restPosition: [...joint.position],
      restRotation: [0, 0, 0, 1],
      tail: null,
      side: key.startsWith('left') ? 'L' : key.startsWith('right') ? 'R' : 'C',
      mirror: null,
      deleted: null,
      role: key === 'root' ? 'helper' : 'bone',
      key,
    });
  }
  const bones = joints.filter((joint) => joint.role === 'bone');
  const P = data.counts.points;
  const ji = new Uint16Array(4 * P);
  const w = new Float32Array(4 * P);
  for (let p = 0; p < P; p++) {
    const ranked = bones
      .map((joint, j) => ({
        j,
        d: Math.hypot(...joint.restPosition.map((v, k) => v - (data.position[3 * p + k] as number))),
      }))
      .sort((u, v) => u.d - v.d || u.j - v.j);
    const a0 = 1 / Math.max(ranked[0]?.d ?? 1, 1e-4);
    const a1 = 1 / Math.max(ranked[1]?.d ?? 1, 1e-4);
    ji[4 * p] = ranked[0]?.j ?? 0;
    ji[4 * p + 1] = ranked[1]?.j ?? 0;
    w[4 * p] = Math.fround(a0 / (a0 + a1));
    w[4 * p + 1] = Math.fround(1 - (w[4 * p] as number));
  }
  const skin: SkinWeights = {
    points: P,
    palette: bones.map((joint) => ({ key: joint.id, parent: joint.parent, mirror: null })),
    joints: ji,
    weights: w,
  };
  a.store.transact({ label: 'joints and bind (test)' }, (tx) => {
    for (const joint of joints) tx.put('joints', joint);
    meshes.writeData(tx, mesh, withSkin(data, skin));
    tx.patch('meshes', mesh, { skin: { skeleton: made.skeleton, bind: null } });
  });
  await runOk(a, 'rig.autoRig.update', { character: made.character });
  await settled(a);
  return { character: made.character, skeleton: made.skeleton, mesh };
}

export const settled = (a: EditorApp) => (a.characters as unknown as { settled(): Promise<void> }).settled();

/** An idle slot clip: `fk.upperArm.L` rz keyed 0/20/0° at frames 0/15/30. */
export async function idleClip(a: EditorApp, character: CharacterId): Promise<ClipId> {
  const { clip } = (await runOk(a, 'clip.new', { character, name: 'Idle', range: { start: 0, end: 30 } })) as {
    clip: ClipId;
  };
  await runOk(a, 'clip.setSettings', { clip, slot: 'idle', loop: true });
  const rig = a.store.query.rigOfCharacter(character);
  const control = rig === undefined ? undefined : a.store.query.controlByKey(rig.id, 'fk.upperArm.L');
  if (control === undefined) throw new Error('no fk.upperArm.L');
  for (const [frame, degrees] of [
    [0, 0],
    [15, 20],
    [30, 0],
  ] as const) {
    setSceneFrame(a, frame);
    await runOk(a, 'channel.setValues', {
      edits: [{ control: control.id, channel: 'rz', value: degrees * DEG }],
      key: 'force',
    });
  }
  return clip;
}

/** The ready character: Blinn torso material, CC0 meta, thumbnail, the idle clip. */
export async function readyCharacter(a: EditorApp) {
  const made = await bodyCharacter(a);
  await runOk(a, 'palette.assignMaterial', { shader: 'blinn', meshes: [made.mesh] });
  await runOk(a, 'char.setVrmMeta', {
    character: made.character,
    patch: { authors: ['Tester'], licensePreset: 'cc0' },
  });
  await runOk(a, 'char.renderThumbnail', { character: made.character });
  await idleClip(a, made.character);
  await settled(a);
  return made;
}

export async function exportCharacter(a: EditorApp, args: Json): Promise<ExportArtifact> {
  const [artifact] = (await runOk(a, 'file.exportCharacter', args)) as ExportArtifact[];
  if (artifact === undefined) throw new Error('no artifact');
  return artifact;
}

export async function vrmErrors(bytes: Uint8Array): Promise<string[]> {
  const report = await vrmValidator.validateBytes(bytes, { format: 'glb', maxIssues: 0, writeTimestamp: false });
  return report.issues.messages.filter((m) => m.severity === 0).map((m) => `${m.code} ${m.pointer ?? ''} ${m.message}`);
}
