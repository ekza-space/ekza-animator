import { quatAngle, type Quat, type ReadonlyXf } from '@ekza-animator/anim-core';
import type { HumanBoneName } from '@ekza-animator/doc';
import { type LicensedFixture, readFixture } from '@ekza-animator/doc/testing';
import { HUMAN_BONE_NAMES, HUMAN_BONE_PARENT, type SkeletonDesc } from '@ekza-animator/rig';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { readAnimations } from '../src/animation/read';
import { bakeClip, ekzaAnimationMeta } from '../src/bake/bake';
import { parseGlb } from '../src/glb/parse';
import { nodesOf } from '../src/gltf/schema';
import { skeletonFromGltf } from '../src/skeleton/read';
import { humanoidRestPositions } from '../src/skeleton/rest';
import { createFkPoseSource } from '../src/testing';
import type { BakedClip, PoseSource } from '../src/types';
import { validateGltf } from '../src/validate/validate';
import { readVrma } from '../src/vrma/read';
import { clipExportName, exportFileName, writeAnimationGlb, writeVrma } from '../src/writers/write';
import { bakeOptions, clipMeta, rotated } from './helpers/bake';

async function fixtureSkeleton(name: LicensedFixture): Promise<SkeletonDesc> {
  return skeletonFromGltf(await parseGlb(readFixture(name)));
}

/** Waves the humanoid arms (or, for generic rigs, the first few joints) over the clip. */
function poseSource(skeleton: SkeletonDesc): PoseSource {
  const humanoid = skeleton.humanoid;
  const animated = new Set(
    humanoid !== null
      ? (['leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'spine', 'hips'] as HumanBoneName[])
          .map((b) => humanoid[b])
          .filter((n) => n !== undefined)
      : skeleton.nodes
          .filter((n) => n.isJoint)
          .slice(0, 6)
          .map((n) => n.index),
  );
  return createFkPoseSource(skeleton, {
    pose: (node, frame) => {
      if (!animated.has(node)) return null;
      const rest = skeleton.nodes[node]?.restLocal as ReadonlyXf;
      const r = rotated(rest, [0.3, 0.2, 1], Math.sin(frame / 7) * 0.8);
      return node === humanoid?.hips ? { ...r, t: [rest.t[0] + frame * 0.002, rest.t[1], rest.t[2]] } : r;
    },
  });
}

function meta(clips: readonly BakedClip[], rig: 'vrm-humanoid' | 'gltf-nodes') {
  return ekzaAnimationMeta(clips, rig, { toolVersion: '0.1.0', projectSha256: null, baseSha256: null });
}

describe('writeAnimationGlb', () => {
  it.each<LicensedFixture>(['seed-san.vrm', 'polybot.vrm', 'quaternius-ual.glb'])(
    'writes %s clips with 0 validator errors that read back exactly',
    async (name) => {
      const skeleton = await fixtureSkeleton(name);
      const source = poseSource(skeleton);
      const clips = [
        bakeClip(source, bakeOptions({ name: 'wave', meta: clipMeta('wave') })),
        bakeClip(source, bakeOptions({ name: 'idle', range: { start: 0, end: 12 }, meta: clipMeta('idle') })),
      ];
      const artifact = await writeAnimationGlb(skeleton, clips, {
        meta: meta(clips, skeleton.humanoid === null ? 'gltf-nodes' : 'vrm-humanoid'),
        fileName: 'out.glb',
        profile: null,
      });
      const report = await validateGltf(artifact.bytes);
      expect(report.issues.filter((i) => i.severity === 0)).toEqual([]);
      expect(artifact).toMatchObject({ kind: 'animation-glb', fileName: 'out.glb', mime: 'model/gltf-binary' });
      expect(artifact.readBack).toMatchObject({ ok: true, animations: 2 });
      expect(artifact.lints.filter((l) => l.severity === 'error')).toEqual([]);
      expect(artifact.stats.clips).toBe(2);

      const out = await parseGlb(artifact.bytes);
      expect(out.json['meshes']).toBeUndefined();
      expect(out.json['skins']).toBeUndefined();
      const names = new Set(skeleton.nodes.map((n) => n.name));
      expect(nodesOf(out.json).every((n) => names.has(n.name ?? ''))).toBe(true);
      expect(out.json.asset.generator).toBe('Ekza Animator 0.1.0');
      const metaOut = (out.json.asset.extras as Record<string, { clips: { index: number; name: string }[] }>)[
        'ekza_animation_v1'
      ];
      expect(metaOut?.clips.map((c) => [c.index, c.name])).toEqual([
        [0, 'wave'],
        [1, 'idle'],
      ]);

      // Re-read in Node: the raw locals at frame 10 equal the baked samples (E2E-18 in miniature).
      const outSkeleton = skeletonFromGltf(out);
      const [wave] = readAnimations(out, outSkeleton);
      for (const track of clips[0]?.tracks ?? []) {
        const name = skeleton.nodes[track.node]?.name;
        const channel = wave?.channels.find((c) => outSkeleton.nodes[c.node]?.name === name && c.path === track.path);
        expect(channel?.times).toEqual(track.times);
        expect(channel?.values).toEqual(track.values);
      }
    },
  );

  it('keeps only animated nodes and their ancestors and is deterministic', async () => {
    const skeleton = await fixtureSkeleton('seed-san.vrm');
    const clip = bakeClip(poseSource(skeleton), bakeOptions());
    const opts = { meta: meta([clip], 'vrm-humanoid'), fileName: 'a.glb', profile: null };
    const a = await writeAnimationGlb(skeleton, [clip], opts);
    const b = await writeAnimationGlb(skeleton, [clip], opts);
    expect(b.bytes).toEqual(a.bytes);
    expect(b.sha256).toBe(a.sha256);
    const out = await parseGlb(a.bytes);
    const kept = nodesOf(out.json).map((n) => n.name);
    expect(kept).not.toContain('hair_tail_1');
    expect(kept).toContain('upper_arm.L');
  });

  it('refuses humanoid-target clips and duplicate names', async () => {
    const skeleton = await fixtureSkeleton('polybot.vrm');
    const humanoid = bakeClip(poseSource(skeleton), bakeOptions({ target: 'humanoid' }));
    await expect(
      writeAnimationGlb(skeleton, [humanoid], { meta: meta([humanoid], 'vrm-humanoid'), fileName: 'x', profile: null }),
    ).rejects.toMatchObject({ code: 'unsupported' });
    const raw = bakeClip(poseSource(skeleton), bakeOptions({ name: 'Wave' }));
    const twin = { ...raw, name: ' wave ' };
    await expect(
      writeAnimationGlb(skeleton, [raw, twin], { meta: meta([raw], 'vrm-humanoid'), fileName: 'x', profile: null }),
    ).rejects.toThrow(/same name|case-insensitive/);
  });
});

describe('writeVrma', () => {
  it.each<LicensedFixture>(['seed-san.vrm', 'polybot.vrm'])(
    'writes %s VRMA with 0 validator errors and canonical rest positions',
    async (name) => {
      const skeleton = await fixtureSkeleton(name);
      const rest = humanoidRestPositions(skeleton);
      const clip = bakeClip(poseSource(skeleton), bakeOptions({ target: 'humanoid' }));
      const artifact = await writeVrma(skeleton, clip, {
        meta: meta([clip], 'vrm-humanoid'),
        fileName: 'wave.vrma',
        profile: null,
        humanoidRestWorld: rest,
      });
      const report = await validateGltf(artifact.bytes);
      expect(report.issues.filter((i) => i.severity === 0)).toEqual([]);
      expect(artifact.readBack?.ok).toBe(true);
      expect(artifact.lints.filter((l) => l.severity === 'error')).toEqual([]);

      const out = await parseGlb(artifact.bytes);
      expect(out.json['extensionsUsed']).toEqual(['VRMC_vrm_animation']);
      expect(out.json['extensionsRequired']).toBeUndefined();
      const ext = (
        out.json['extensions'] as Record<
          string,
          { specVersion: string; humanoid: { humanBones: Record<string, { node: number }> } }
        >
      )['VRMC_vrm_animation'];
      expect(ext?.specVersion).toBe('1.0');
      const bones = Object.keys(ext?.humanoid.humanBones ?? {});
      expect(bones).not.toContain('leftEye');
      expect(bones.sort()).toEqual(
        Object.keys(skeleton.humanoid ?? {})
          .filter((b) => b !== 'leftEye' && b !== 'rightEye')
          .sort(),
      );
      const nodes = nodesOf(out.json);
      expect(nodes.every((n) => n.rotation === undefined && n.scale === undefined)).toBe(true);
      expect((out.json['animations'] as unknown[]).length).toBe(1);

      // Recompose rest world positions from the file (sum of translations up the tree).
      const parent = new Map<number, number>();
      nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
      const world = (i: number): number[] => {
        const t = nodes[i]?.translation ?? [0, 0, 0];
        const p = parent.get(i);
        const pw = p === undefined ? [0, 0, 0] : world(p);
        return [
          (pw[0] as number) + (t[0] as number),
          (pw[1] as number) + (t[1] as number),
          (pw[2] as number) + (t[2] as number),
        ];
      };
      const wrongParents: string[] = [];
      let restError = 0;
      for (const [bone, entry] of Object.entries(ext?.humanoid.humanBones ?? {})) {
        const expected = rest[bone as HumanBoneName] as readonly number[];
        const got = world(entry.node);
        restError = Math.max(
          restError,
          Math.hypot(
            (got[0] as number) - (expected[0] as number),
            (got[1] as number) - (expected[1] as number),
            (got[2] as number) - (expected[2] as number),
          ),
        );
        // Parented by the humanoid map over present bones (hips under the identity root).
        let p = HUMAN_BONE_PARENT[bone as HumanBoneName];
        while (p !== null && ext?.humanoid.humanBones[p] === undefined) p = HUMAN_BONE_PARENT[p];
        const expectedParent =
          p === null ? nodes.findIndex((n) => n.name === 'root') : ext?.humanoid.humanBones[p]?.node;
        if (parent.get(entry.node) !== expectedParent) wrongParents.push(bone);
      }
      expect(restError).toBeLessThan(1e-5);
      expect(wrongParents).toEqual([]);
      const hipsY = world(ext?.humanoid.humanBones['hips']?.node ?? -1)[1] as number;
      expect(Math.abs(hipsY - (rest.hips?.[1] ?? 0))).toBeLessThan(1e-5);

      // Own VRMA round trip: reading it back gives the baked N_b and hips position.
      const read = readVrma(out);
      let rotationError = 0;
      let positionError = 0;
      for (const track of clip.tracks) {
        const bone = HUMAN_BONE_NAMES[track.node] as HumanBoneName;
        const values =
          (track.path === 'rotation' ? read.rotations[bone]?.values : read.hips?.values) ?? new Float32Array();
        const n = track.path === 'rotation' ? 4 : 3;
        expect(values).toHaveLength(track.values.length);
        for (let k = 0; k < track.times.length; k++) {
          const a = Array.from(track.values.subarray(k * n, k * n + n));
          const b = Array.from(values.subarray(k * n, k * n + n));
          if (n === 4) rotationError = Math.max(rotationError, quatAngle(a as Quat, b as Quat));
          else positionError = Math.max(positionError, Math.hypot(...a.map((v, i) => v - (b[i] as number))));
        }
      }
      expect(rotationError).toBeLessThan(1e-4);
      expect(positionError).toBeLessThan(1e-5);
      expect(read.restHipsPosition[1]).toBeCloseTo(rest.hips?.[1] ?? 0, 6);

      // three-vrm-animation reads the same tracks.
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
      const gltf = await loader.parseAsync(artifact.bytes.slice().buffer, '');
      const vrma = (gltf.userData['vrmAnimations'] as { humanoidTracks: { rotation: Map<string, unknown> } }[])[0];
      expect([...(vrma?.humanoidTracks.rotation.keys() ?? [])].sort()).toEqual(Object.keys(read.rotations).sort());
    },
  );

  it('places the Seed-san hips at its rest height 0.7956 m', async () => {
    const skeleton = await fixtureSkeleton('seed-san.vrm');
    const clip = bakeClip(poseSource(skeleton), bakeOptions({ target: 'humanoid' }));
    const artifact = await writeVrma(skeleton, clip, {
      meta: meta([clip], 'vrm-humanoid'),
      fileName: 'wave.vrma',
      profile: null,
      humanoidRestWorld: humanoidRestPositions(skeleton),
    });
    const read = readVrma(await parseGlb(artifact.bytes));
    expect(Math.abs(read.restHipsPosition[1] - 0.7956)).toBeLessThan(1e-4);
  });

  it('drops tracks VRMA cannot hold, with a lint, and refuses raw clips', async () => {
    const skeleton = await fixtureSkeleton('polybot.vrm');
    const clip = bakeClip(poseSource(skeleton), bakeOptions({ target: 'humanoid' }));
    const spine = HUMAN_BONE_NAMES.indexOf('spine');
    const bogus: BakedClip = {
      ...clip,
      tracks: [
        ...clip.tracks,
        {
          node: spine,
          path: 'scale',
          interpolation: 'LINEAR',
          times: new Float32Array([0, 1]),
          values: new Float32Array(6).fill(1),
        },
      ],
    };
    const opts = {
      meta: meta([clip], 'vrm-humanoid' as const),
      fileName: 'x.vrma',
      profile: null,
      humanoidRestWorld: humanoidRestPositions(skeleton),
    };
    const artifact = await writeVrma(skeleton, bogus, opts);
    expect(artifact.lints.map((l) => l.code)).toContain('vrma.skipped-track');
    expect(artifact.readBack?.ok).toBe(true);
    const raw = bakeClip(poseSource(skeleton), bakeOptions());
    await expect(writeVrma(skeleton, raw, opts)).rejects.toMatchObject({ code: 'unsupported' });
    await expect(writeVrma(skeleton, clip, { ...opts, humanoidRestWorld: {} })).rejects.toThrow(/hips/);
  });
});

describe('names', () => {
  it('exports the slot, else the sanitized clip name', () => {
    expect(clipExportName({ name: 'Walk Fast', slot: 'walk' })).toBe('walk');
    expect(clipExportName({ name: '  Walk  Fast!! ', slot: null })).toBe('Walk_Fast');
    expect(clipExportName({ name: 'Idle_Loop', slot: null })).toBe('Idle_Loop');
    expect(clipExportName({ name: '***', slot: null })).toBe('clip');
  });

  it('fills file-name patterns and sanitizes them', () => {
    expect(exportFileName('{character}_{clip}', { character: 'Seed-san', clip: 'wave', fps: 30 }, 'vrma')).toBe(
      'Seed-san_wave.vrma',
    );
    expect(exportFileName('{character} {clip} @{fps}', { character: 'My Bot', clip: 'idle', fps: 29.97 }, '.glb')).toBe(
      'My_Bot_idle_29.97.glb',
    );
    expect(exportFileName('../{clip}', { character: 'a', clip: 'b/c', fps: 24 }, 'vrm')).toBe('b_c.vrm');
    expect(exportFileName('', { character: 'a', clip: 'b', fps: 24 }, 'glb')).toBe('export.glb');
  });
});
