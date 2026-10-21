// M6B-SPEC §5.1, §9 C1 (headless, the production kernel): a model character made in the app (the generated body,
// `char.fromModel`, Standard 33 joints, bound, `rig.autoRig.update`) —
// - `skeletonFromGltf(writeCharacter(records))` equals the runtime's `skeletonFromDoc` on the joint subset (names,
//   parents, rest locals within 1e-6, the humanoid map by name, jointsFingerprint, radii within 1e-4 H);
// - the character-runtime chunk loads for a model-sourced project opened in Animate (save → open in a fresh app);
// - the display hides in Model (mesh-view draws the meshes there) and shows elsewhere;
// - the synthesized container rebuild with a three.js ModelLoader stays within 300 ms (report-only).
import { readFileSync } from 'node:fs';
import {
  type CharacterId,
  fractionalIndex,
  type HumanBoneName,
  type JointId,
  type JointRecord,
  type MeshId,
  type SkeletonId,
  seededIdSource,
} from '@ekza-studio/doc';
import {
  attachMeshes,
  createEditorApp,
  type DisplayModel,
  type EditorApp,
  type KernelMeshRuntimes,
  loadCharacterRuntime,
  loadMeshKernel,
  type ModelLoader,
} from '@ekza-studio/editor-core';
import { createFakeServices } from '@ekza-studio/editor-core/testing';
import { jointsFingerprint, parseGlb, skeletonFromGltf, writeCharacter } from '@ekza-studio/io';
import { loadGltfInNode } from '@ekza-studio/io/testing';
import { type SkinWeights, withSkin } from '@ekza-studio/mesh-core';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { beforeAll, describe, expect, it } from 'vitest';
import { runOk } from './ops.support';

const TRUTH = JSON.parse(
  readFileSync(new URL('../../../fixtures/models/cube-lad-truth.json', import.meta.url), 'utf8'),
) as {
  readonly joints: Readonly<
    Record<string, { readonly position: readonly [number, number, number]; readonly parent: string | null }>
  >;
};

beforeAll(async () => {
  await loadMeshKernel();
});

/** A ModelLoader over three.js in Node (io/testing): enough for display timing and visibility. */
function nodeModelLoader(): ModelLoader & { loads: number } {
  const loader = {
    loads: 0,
    setRenderer() {},
    async load(container: { readonly bytes: Uint8Array }): Promise<DisplayModel> {
      loader.loads++;
      const model = await loadGltfInNode(container.bytes);
      return { kind: 'three', handle: { root: model.scene, skinnedMeshes: [] }, dispose() {} };
    },
  };
  return loader;
}

function app(models: ModelLoader | null = null): EditorApp {
  const services = createFakeServices();
  const a = createEditorApp({ services: { ...services, models }, idSource: seededIdSource(11) });
  a.prefs.setState({ firstRunDone: true });
  if (models !== null) a.services.models?.setRenderer({});
  return a;
}

/** The generated body (1.7 m) as a model character with the Cube Lad's Standard 33 joints, bound and rigged. */
async function bodyCharacter(a: EditorApp): Promise<{ character: CharacterId; skeleton: SkeletonId; mesh: MeshId }> {
  const meshes = attachMeshes(a) as KernelMeshRuntimes;
  await runOk(a, 'mesh.create.template', { template: 'humanoidBody', height: 1.7 });
  const body = a.session.getState().selection.objects;
  const made = (await runOk(a, 'char.fromModel', { objects: body })) as {
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
  // Two nearest bones per point, inverse-distance blended (a deterministic stand-in for a bind).
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
  await (a.characters as unknown as { settled(): Promise<void> }).settled();
  return { character: made.character, skeleton: made.skeleton, mesh };
}

function subset(desc: SkeletonDesc) {
  const nodes = desc.nodes.filter((node) => node.isJoint);
  return new Map(
    nodes.map((node) => [
      node.name,
      {
        parent: node.parent === -1 ? '' : (desc.nodes[node.parent]?.name ?? ''),
        t: node.restLocal.t,
        q: node.restLocal.q,
        radius: desc.boneRadii[node.index] ?? null,
      },
    ]),
  );
}

describe('a model character made in the app (§5.1)', { timeout: 120_000 }, () => {
  it('skeletonFromGltf(writeCharacter(records)) equals the runtime SkeletonDesc on the joint subset', async () => {
    const a = app();
    const { character } = await bodyCharacter(a);
    const runtime = a.characters.get(character);
    if (runtime === undefined) throw new Error('no runtime');
    const chunk = await loadCharacterRuntime();
    const parts = chunk.modelParts(a, character);
    if (parts === null || parts === 'loading') throw new Error('no parts');
    const kernel = await loadMeshKernel();
    const meshes = chunk.characterMeshes(a.store, kernel, parts);
    const bytes = await writeCharacter(
      {
        skeleton: runtime.skeleton,
        joints: parts.joints,
        meshes,
        palettes: chunk.characterPalettes(a.store, meshes),
        clips: [],
        vrm: null,
        thumbnailPng: null,
        model: chunk.modelProvenance(parts, runtime.skeleton, 'test'),
        heightScale: null,
      },
      { generator: 'test', format: 'vrm' },
    );
    const read = skeletonFromGltf(await parseGlb(bytes));
    const doc = subset(runtime.skeleton);
    const gltf = subset(read);
    expect([...gltf.keys()].sort()).toEqual([...doc.keys()].sort());
    const H = read.height;
    const problems: string[] = [];
    for (const [name, x] of doc) {
      const y = gltf.get(name);
      if (y === undefined) continue;
      if (x.parent !== y.parent) problems.push(`${name} parent`);
      if (x.t.some((v, i) => Math.abs(v - (y.t[i] as number)) > 1e-6)) problems.push(`${name} t`);
      if (x.q.some((v, i) => Math.abs(v - (y.q[i] as number)) > 1e-6)) problems.push(`${name} q`);
      if ((x.radius === null) !== (y.radius === null)) problems.push(`${name} radius ${x.radius} ${y.radius}`);
      else if (x.radius !== null && y.radius !== null && Math.abs(x.radius - y.radius) > 1e-4 * H) {
        problems.push(`${name} radius ${x.radius} vs ${y.radius}`);
      }
    }
    expect(problems).toEqual([]);
    const byName = (desc: SkeletonDesc) =>
      Object.fromEntries(Object.entries(desc.humanoid ?? {}).map(([bone, node]) => [bone, desc.nodes[node]?.name]));
    expect(byName(read)).toEqual(byName(runtime.skeleton));
    expect(jointsFingerprint(read.nodes)).toBe(runtime.skeleton.fingerprint);
    expect(runtime.skeleton.heightSource).toBe('mesh');
  });

  it('loads the character-runtime chunk for a model-sourced project opened in Animate', async () => {
    const services = createFakeServices();
    const a = createEditorApp({ services, idSource: seededIdSource(12) });
    a.prefs.setState({ firstRunDone: true });
    const { character } = await bodyCharacter(a);
    const fingerprint = a.characters.get(character)?.skeleton.fingerprint;
    await runOk(a, 'file.save');
    const download = services.downloads.at(-1);
    const other = app();
    await runOk(other, 'file.openProject', { name: download?.fileName, bytes: download?.bytes });
    expect(other.session.getState().workspace).toBe('animate');
    await (other.characters as unknown as { settled(): Promise<void> }).settled();
    const runtime = other.characters.get(character);
    expect(runtime?.skeleton.fingerprint).toBe(fingerprint);
    expect(runtime?.program.controls.length).toBeGreaterThan(30);
  });

  it('hides the display in Model and shows it elsewhere; rebuilds container + display within 300 ms', async ({
    annotate,
  }) => {
    const loader = nodeModelLoader();
    const a = app(loader);
    const { character } = await bodyCharacter(a);
    const registry = a.characters as unknown as { settled(): Promise<void>; redisplay(id: CharacterId): Promise<void> };
    await registry.settled();
    const root = () =>
      (a.characters.get(character)?.display?.handle as { root: { visible: boolean } } | undefined)?.root;
    expect(root()?.visible).toBe(true);
    a.session.setState({ workspace: 'model' });
    expect(root()?.visible).toBe(false);
    a.session.setState({ workspace: 'rig' });
    expect(root()?.visible).toBe(true);
    const runs = 3;
    const start = performance.now();
    for (let i = 0; i < runs; i++) await registry.redisplay(character);
    const ms = (performance.now() - start) / runs;
    const json = a.characters.get(character)?.container.json as { meshes?: unknown[] };
    await annotate(
      `container rebuild + three.js load (generated body, 34 joints, ${json.meshes?.length ?? 0} mesh): ${ms.toFixed(1)} ms (budget 300 ms)`,
    );
    expect(loader.loads).toBeGreaterThanOrEqual(1 + runs);
  });
});
