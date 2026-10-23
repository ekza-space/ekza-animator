// Acceptance round 4 (AUTORIG-SPEC §5.4, §5.6.2; DECISIONS-OPEN §M AR-R4-*): a multi-part character — the Cube Lad and
// a hairdo of three boxes (one over the head, one beside each side of it, hanging to the shoulders) — rigged by
// `autorig.rig`:
// - AR-R4-5: without `rigidParts` the side boxes follow the shoulders while the top one follows the head; Validation
//   says so (`skin.cross-limb`, a warning in both profiles). With `rigidParts` the hairdo is bound to its best joint
//   alone (the head; one more Bind Skin step, M6b's rigid attach) and the row is gone.
// - AR-R4-4: the joints no part moves are one row named after the character, not one per mesh.
// - AR-R4-2: a giant character has the `skel.height` warning.
import { readFileSync } from 'node:fs';
import type { CharacterId, JointRecord, MeshId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import { crossLimbParts, type EditorApp, quickRigOf, rigidPartBinds } from '../../src';
import { meshKernel } from '../../src/mesh/kernel';
import { crossesLimbs, limbRegions, mainBones, reachOf, regionOfBone } from '../../src/rig/validation/limbs';
import { meshTestApp } from '../mesh/support';
import { boxesGlb } from './glb';

const fixture = (file: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../fixtures/models/${file}`, import.meta.url)));

async function ok<T = unknown>(app: EditorApp, id: string, args?: unknown): Promise<T> {
  const result = await app.runUntyped(id, args);
  if (result.status !== 'finished') throw new Error(`${id}: ${JSON.stringify(result)}`);
  return result.value as T;
}
const labels = (app: EditorApp): string[] => {
  const out: string[] = [];
  while (app.history.canUndo()) out.push(app.history.undo()?.label ?? '?');
  while (app.history.canRedo()) app.history.redo();
  return out.reverse();
};

/** The Cube Lad's head box is x ±0.11, y 1.48–1.70; its upper arms start at x ±0.18, y 1.28–1.38. */
const HAIR = boxesGlb('Tema_lowpoly_v0_14:pCube63', [
  [
    [-0.13, 1.66, -0.13],
    [0.13, 1.78, 0.15],
  ],
  [
    [0.14, 1.3, -0.08],
    [0.3, 1.62, 0.1],
  ],
  [
    [-0.3, 1.3, -0.08],
    [-0.14, 1.62, 0.1],
  ],
]);

async function rigged(rigidParts: boolean): Promise<{ app: EditorApp; character: CharacterId; hair: MeshId }> {
  const { app } = await meshTestApp();
  await app.rig.load();
  await ok(app, 'workspace.set', { workspace: 'rig' });
  const lad = (
    await ok<{ meshes: MeshId[] }>(app, 'mesh.importStatic', { bytes: fixture('cube-lad.glb'), name: 'lad.glb' })
  ).meshes;
  const hair = (await ok<{ meshes: MeshId[] }>(app, 'mesh.importStatic', { bytes: HAIR, name: 'hair.glb' })).meshes;
  // the markers the guess places on the Cube Lad alone (the hairdo would raise the head top), set on both meshes
  await ok(app, 'skel.quickRig.start', { meshes: lad });
  const markers = Object.entries(quickRigOf(app)?.markers ?? {});
  await ok(app, 'skel.quickRig.cancel');
  await ok(app, 'skel.quickRig.start', { meshes: [...lad, ...hair] });
  for (const [name, point] of markers) await ok(app, 'skel.quickRig.setMarker', { name, point });
  expect(quickRigOf(app)?.preview).not.toBeNull();
  const { character } = await ok<{ character: CharacterId }>(app, 'autorig.rig', { rigidParts });
  const meshes = app.store.query.meshesOfOwner(character).filter((mesh) => mesh.deleted === null);
  const hairMesh = meshes.find((mesh) => mesh.name.endsWith('pCube63'))?.id as MeshId;
  expect(hairMesh).toBeDefined();
  return { app, character, hair: hairMesh };
}

const rows = (app: EditorApp, character: CharacterId, profile = 'ekza/space-avatar-v1') =>
  app.rig.validation.rows(character, profile);

/** The joints a mesh's points carry weight on, by their human bone (or name). */
function weightedBones(app: EditorApp, mesh: MeshId): string[] {
  const data = app.meshes.get(mesh)?.data();
  const skin = data === undefined || data === null ? null : meshKernel()?.readSkin(data);
  if (skin === null || skin === undefined) return [];
  const used = new Set<string>();
  for (let i = 0; i < skin.weights.length; i++) {
    if ((skin.weights[i] as number) > 0) used.add(skin.palette[skin.joints[i] as number]?.key ?? '?');
  }
  return [...used].map((key) => {
    const joint = app.store.get('joints', key as never);
    return joint?.humanBone ?? joint?.name ?? key;
  });
}

describe('separate parts (AR-R4-5, the owner’s AR-D10-7 call)', () => {
  it('regions: the head, the torso, each arm and leg; eyes are the head’s, fingers the hand’s arm', () => {
    expect(['neck', 'leftEye', 'jaw'].map(regionOfBone)).toEqual(['head', 'head', 'head']);
    expect(['hips', 'upperChest'].map(regionOfBone)).toEqual(['torso', 'torso']);
    expect(['leftShoulder', 'leftIndexDistal', 'rightLowerArm'].map(regionOfBone)).toEqual([
      'leftArm',
      'leftArm',
      'rightArm',
    ]);
    expect(['leftToes', 'rightUpperLeg'].map(regionOfBone)).toEqual(['leftLeg', 'rightLeg']);
    // a joint without a VRM bone takes its nearest mapped ancestor's region
    const joint = (id: string, parent: string | null, humanBone: string | null) =>
      ({ id, parent, humanBone }) as unknown as JointRecord;
    const regions = limbRegions([joint('a', null, 'hips'), joint('b', 'a', 'leftUpperArm'), joint('c', 'b', null)]);
    expect([...regions]).toEqual([
      ['a', 'torso'],
      ['b', 'leftArm'],
      ['c', 'leftArm'],
    ]);
  });

  it('how a cross-limb part binds again: rigid on its best bone, a whole-limb part over its own limb (knee kept)', () => {
    // a chain: hips → right upper leg → lower leg → foot; spine → right shoulder → upper arm → lower arm → hand → index;
    // spine → neck → head. Rest positions: legs down the −y side, the arm hanging beside the leg.
    const j = (id: string, parent: string | null, humanBone: string | null, p: [number, number, number]) =>
      ({ id, parent, humanBone, role: 'bone', restPosition: p, tail: null }) as unknown as JointRecord;
    const joints = [
      j('hips', null, 'hips', [0, 1, 0]),
      j('ul', 'hips', 'rightUpperLeg', [-0.1, 0.95, 0]),
      j('ll', 'ul', 'rightLowerLeg', [-0.1, 0.5, 0]),
      j('ft', 'll', 'rightFoot', [-0.1, 0.08, 0]),
      j('sp', 'hips', 'spine', [0, 1.2, 0]),
      j('sh', 'sp', 'rightShoulder', [-0.05, 1.45, 0]),
      j('ua', 'sh', 'rightUpperArm', [-0.2, 1.45, 0]),
      j('la', 'ua', 'rightLowerArm', [-0.25, 1.15, 0]),
      j('hd', 'la', 'rightHand', [-0.27, 0.9, 0]),
      j('ix', 'hd', 'rightIndexProximal', [-0.27, 0.8, 0]),
      j('nk', 'sp', 'neck', [0, 1.5, 0]),
      j('he', 'nk', 'head', [0, 1.6, 0]),
    ];
    expect(mainBones(joints).get('ix')).toBe('hd');
    const regions = limbRegions(joints);
    const skin = (weights: Record<string, number>, points = 10) => {
      const keys = Object.keys(weights);
      const out = {
        points,
        palette: keys.map((key) => ({ key, parent: null, mirror: null })),
        joints: new Uint16Array(4 * points),
        weights: new Float32Array(4 * points),
      };
      // every point carries the same weights (≤ 4)
      for (let p = 0; p < points; p++)
        keys.forEach((key, k) => {
          out.joints[4 * p + k] = k;
          out.weights[4 * p + k] = weights[key] as number;
        });
      return out;
    };
    const at = (x: number, y: number) =>
      Float32Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? x : i % 3 === 1 ? y : 0));
    // a whole-leg cylinder the hanging hand reaches: the leg's joints only, automatic weights
    const leg = reachOf('msh_leg' as MeshId, skin({ ul: 0.45, ll: 0.45, hd: 0.1 }), at(-0.1, 0.7), joints, regions);
    expect(crossesLimbs(leg)).toBe(true);
    expect(leg.regions).toEqual(['rightLeg', 'rightArm']);
    expect(leg.bind).toEqual({ joints: ['ul', 'll', 'ft'], rigid: false });
    // a mitten (hand and finger) touching the thigh: rigid on the hand
    const mitten = reachOf(
      'msh_mitten' as MeshId,
      skin({ hd: 0.5, ix: 0.4, ll: 0.1 }),
      at(-0.27, 0.85),
      joints,
      regions,
    );
    expect(mitten.regions).toEqual(['rightArm', 'rightLeg']);
    expect(mitten.bind).toEqual({ joints: ['hd'], rigid: true });
    // a hairdo: rigid on the head
    const hair = reachOf('msh_hair' as MeshId, skin({ he: 0.8, ua: 0.1, nk: 0.1 }), at(0, 1.62), joints, regions);
    expect(hair.bind).toEqual({ joints: ['he'], rigid: true });
    // an arm part blending into the chest reaches only regions that meet
    expect(
      crossesLimbs(reachOf('msh_arm' as MeshId, skin({ ua: 0.6, la: 0.3, sp: 0.1 }), at(-0.2, 1.3), joints, regions)),
    ).toBe(false);
  });

  it('a hairdo following the head and both shoulders is a cross-limb warning; rigidParts binds it to the head', async () => {
    const plain = await rigged(false);
    expect(labels(plain.app).slice(-2)).toEqual(['Create Skeleton', 'Bind Skin']);
    // the automatic weights: the side boxes follow the shoulders (or upper arms)
    const bones = weightedBones(plain.app, plain.hair);
    expect(bones).toContain('head');
    expect(bones.some((bone) => /^left(Shoulder|UpperArm)$/.test(bone))).toBe(true);
    expect(bones.some((bone) => /^right(Shoulder|UpperArm)$/.test(bone))).toBe(true);
    const parts = crossLimbParts(plain.app, plain.character);
    expect(parts.map((part) => part.mesh)).toEqual([plain.hair]);
    expect(parts[0]?.regions).toEqual(expect.arrayContaining(['head', 'leftArm', 'rightArm']));
    const best = plain.app.store.get('joints', parts[0]?.best as never);
    expect(best?.humanBone).toBe('head');
    for (const profile of ['ekza/space-avatar-v1', 'local/generic']) {
      const row = rows(plain.app, plain.character, profile).find((r) => r.code === 'skin.cross-limb');
      expect(row).toMatchObject({ severity: 'warning', ids: [plain.hair] });
      // the part's own name, without the modelling tool's namespace
      expect(row?.message).toMatch(/^pCube63 moves with the head, the (left|right) arm and the (left|right) arm/);
    }
    expect(rigidPartBinds(plain.app, plain.character)).toEqual([
      { joints: [best?.id], rigid: true, meshes: [plain.hair] },
    ]);

    const rigid = await rigged(true);
    // one more Bind Skin: the hairdo alone, rigidly on the head
    expect(labels(rigid.app).slice(-3)).toEqual(['Create Skeleton', 'Bind Skin', 'Bind Skin']);
    expect(weightedBones(rigid.app, rigid.hair)).toEqual(['head']);
    expect(rows(rigid.app, rigid.character).some((r) => r.code === 'skin.cross-limb')).toBe(false);
    expect(crossLimbParts(rigid.app, rigid.character)).toEqual([]);
    // the body keeps its automatic weights
    const body = rigid.app.store.query
      .meshesOfOwner(rigid.character)
      .find((mesh) => mesh.deleted === null && mesh.id !== rigid.hair)?.id as MeshId;
    expect(weightedBones(rigid.app, body).length).toBeGreaterThan(10);
  });

  it('AR-R4-4: the joints no part moves are one row named after the character', async () => {
    const { app, character } = await rigged(true);
    const name = app.store.get('characters', character)?.name;
    const unweighted = rows(app, character).filter((r) => r.code === 'skin.joint-without-weights');
    expect(unweighted).toHaveLength(1);
    expect(unweighted[0]?.message).toMatch(new RegExp(`^\\d+ joints? of ${name} influence nothing$`));
    expect(unweighted[0]?.message).not.toContain('pCube');
    // the ids are joints (Select picks them)
    for (const id of unweighted[0]?.ids ?? []) expect(app.store.get('joints', id as never)).toBeDefined();
  });

  it('`rigidParts` must be a boolean', async () => {
    const { app } = await meshTestApp();
    await app.rig.load();
    expect(app.operators.poll('autorig.rig', undefined, { rigidParts: 'yes' })).toEqual({
      ok: false,
      reason: 'rigidParts must be true or false',
    });
  });
});
