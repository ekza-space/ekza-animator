import { type LicensedFixture, readFixture } from '@ekza-animator/doc/testing';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { describe, expect, it } from 'vitest';
import { readAnimations } from '../src/animation/read';
import { parseGlb } from '../src/glb/parse';
import { jsonEqual } from '../src/gltf/json';
import { animationsOf } from '../src/gltf/schema';
import { sha256HexSync } from '../src/hash/sha256';
import { skeletonFromGltf } from '../src/skeleton/read';
import { BAKE_MARKER_KEY, bakeIntoModel, preexistingTracks } from '../src/surgeon/bakeIntoModel';
import { GltfBuilder } from '../src/testing/glb';
import type { BakedClip, EkzaBakeMarkerV1, ExportArtifact, GlbContainer } from '../src/types';
import { compareValidation, validateGltf } from '../src/validate/validate';
import { metaOf, rawClip } from './helpers/poses';

type Json = Record<string, unknown>;

async function setup(name: LicensedFixture) {
  const source = await parseGlb(readFixture(name));
  return { source, skeleton: skeletonFromGltf(source) };
}

function bake(original: GlbContainer, skeleton: SkeletonDesc, clips: readonly BakedClip[]): Promise<ExportArtifact> {
  return bakeIntoModel(original, skeleton, clips, {
    meta: metaOf(clips, skeleton),
    fileName: 'out.vrm',
    profile: null,
  });
}

const markerOf = (c: GlbContainer): EkzaBakeMarkerV1 =>
  (c.json.asset.extras as Record<string, EkzaBakeMarkerV1>)[BAKE_MARKER_KEY] as EkzaBakeMarkerV1;

/** Every original JSON value survives: arrays keep their prefix, other keys deep-equal (asset.extras excepted). */
function expectPreserved(source: GlbContainer, out: GlbContainer, replaced: readonly number[] = []): void {
  const before = source.json as Json;
  const after = out.json as Json;
  const problems: string[] = [];
  for (const [key, value] of Object.entries(before)) {
    if (key === 'asset') {
      const { extras: _a, ...restBefore } = value as Json;
      const { extras: _b, ...restAfter } = after[key] as Json;
      if (!jsonEqual(restBefore, restAfter)) problems.push('asset');
    } else if (key === 'buffers') {
      const [b0, ...others] = value as Json[];
      const [a0, ...othersAfter] = after[key] as Json[];
      const { byteLength: _x, ...b0rest } = b0 ?? {};
      const { byteLength: _y, ...a0rest } = a0 ?? {};
      if (!jsonEqual(b0rest, a0rest) || !jsonEqual(others, othersAfter)) problems.push('buffers');
    } else if (Array.isArray(value)) {
      const list = after[key] as unknown[];
      value.forEach((entry, i) => {
        if (key === 'animations' && replaced.includes(i)) return;
        if (!jsonEqual(entry, list[i])) problems.push(`${key}[${i}]`);
      });
    } else if (!jsonEqual(value, after[key])) {
      problems.push(key);
    }
  }
  expect(problems).toEqual([]);
  const baseBinLength = ((before['buffers'] as Json[] | undefined)?.[0]?.['byteLength'] as number | undefined) ?? 0;
  expect(sha256HexSync(out.bin?.subarray(0, baseBinLength) ?? new Uint8Array())).toBe(
    sha256HexSync(source.bin?.subarray(0, baseBinLength) ?? new Uint8Array()),
  );
}

function hasUriKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUriKey);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([k, v]) => k.toLowerCase() === 'uri' || hasUriKey(v));
}

describe('bakeIntoModel', () => {
  it.each<LicensedFixture>(['seed-san.vrm', 'polybot.vrm', 'quaternius-ual.glb'])(
    'appends a clip to %s losslessly with no new validator errors',
    async (name) => {
      const { source, skeleton } = await setup(name);
      const clip = rawClip(skeleton, 'wave');
      const artifact = await bake(source, skeleton, [clip]);
      const out = await parseGlb(artifact.bytes);
      expectPreserved(source, out);
      const [sourceReport, outReport] = await Promise.all([validateGltf(source.bytes), validateGltf(artifact.bytes)]);
      expect(compareValidation(sourceReport, outReport)).toEqual([]);
      expect(artifact.readBack?.ok).toBe(true);
      expect(artifact.lints.filter((l) => l.severity === 'error')).toEqual([]);
      expect(artifact.stats.bytesAppended).toBeGreaterThan(0);
      const animations = animationsOf(out.json);
      expect(animations.at(-1)?.name).toBe('wave');
      expect(animations.length).toBe(animationsOf(source.json).length + 1);
      for (const ext of ['VRM', 'VRMC_vrm', 'VRMC_springBone']) {
        expect(
          jsonEqual(
            (out.json['extensions'] as Json | undefined)?.[ext],
            (source.json['extensions'] as Json | undefined)?.[ext],
          ),
        ).toBe(true);
      }
      const marker = markerOf(out);
      expect(marker).toMatchObject({
        baseAnimations: animationsOf(source.json).length,
        baseAccessors: (source.json['accessors'] as unknown[]).length,
        baseBufferViews: (source.json['bufferViews'] as unknown[]).length,
        baseSha256: source.sha256,
        replaced: {},
      });
      expect(hasUriKey(marker)).toBe(false);
      expect(out.json.asset.generator).toBe(source.json.asset.generator);
      // The clip reads back from the baked file exactly.
      const read = readAnimations(out, skeletonFromGltf(out)).find((c) => c.name === 'wave');
      for (const track of clip.tracks) {
        const channel = read?.channels.find((c) => c.node === track.node && c.path === track.path);
        expect(channel?.values).toEqual(track.values);
      }
    },
  );

  it('re-bakes identical input byte-identically (deterministic, rolls back first)', async () => {
    const { source, skeleton } = await setup('seed-san.vrm');
    const clip = rawClip(skeleton, 'wave');
    const first = await bake(source, skeleton, [clip]);
    const again = await bake(source, skeleton, [clip]);
    expect(again.sha256).toBe(first.sha256);
    const rebaked = await bake(await parseGlb(first.bytes), skeleton, [clip]);
    expect(rebaked.sha256).toBe(first.sha256);
    expect(rebaked.lints.map((l) => l.code)).not.toContain('surgeon.no-rollback');
  });

  it('on UAL, replaces Idle_Loop in place, then a Walk_Loop re-bake restores it exactly', async () => {
    const { source, skeleton } = await setup('quaternius-ual.glb');
    const sourceAnimations = animationsOf(source.json);
    const idle = sourceAnimations.findIndex((a) => a.name === 'Idle_Loop');
    const walk = sourceAnimations.findIndex((a) => a.name === 'Walk_Loop');
    const first = await bake(source, skeleton, [rawClip(skeleton, 'idle_loop')]);
    const once = await parseGlb(first.bytes);
    expect(animationsOf(once.json)).toHaveLength(sourceAnimations.length);
    expect(animationsOf(once.json)[idle]?.name).toBe('idle_loop');
    expect(Object.keys(markerOf(once).replaced)).toEqual([String(idle)]);
    expectPreserved(source, once, [idle]);

    const second = await bake(once, skeleton, [rawClip(skeleton, 'Walk_Loop', 3)]);
    const twice = await parseGlb(second.bytes);
    const animations = animationsOf(twice.json);
    expect(jsonEqual(animations[idle], sourceAnimations[idle])).toBe(true);
    expect(animations[walk]?.name).toBe('Walk_Loop');
    expect(jsonEqual(animations[walk], sourceAnimations[walk])).toBe(false);
    expect(Object.keys(markerOf(twice).replaced).sort()).toEqual([String(idle), String(walk)].sort());
    expectPreserved(source, twice, [walk]);
    const [a, b] = await Promise.all([validateGltf(source.bytes), validateGltf(second.bytes)]);
    expect(compareValidation(a, b)).toEqual([]);
    // Only the animator's clip is described by the metadata.
    const meta = (twice.json.asset.extras as Json)['ekza_animation_v1'] as { clips: { index: number; name: string }[] };
    expect(meta.clips.map((c) => [c.index, c.name])).toEqual([[walk, 'Walk_Loop']]);
  });

  it('rolls back to the original when re-baked with no clips', async () => {
    const { source, skeleton } = await setup('polybot.vrm');
    const baked = await parseGlb((await bake(source, skeleton, [rawClip(skeleton, 'wave')])).bytes);
    const back = await bakeIntoModel(baked, skeleton, [], {
      meta: metaOf([], skeleton),
      fileName: 'x.vrm',
      profile: null,
    });
    const out = await parseGlb(back.bytes);
    const { asset: a1, ...restSource } = source.json as Json;
    const { asset: a2, ...restOut } = out.json as Json;
    expect(jsonEqual(restSource, restOut)).toBe(true);
    const { extras: _e1, ...assetSource } = a1 as Json;
    const { extras: _e2, ...assetOut } = a2 as Json;
    expect(assetOut).toEqual(assetSource);
    expect(out.bin).toEqual(source.bin);
    expect(back.stats.bytesAppended).toBe(0);
  });

  it('refuses matrix nodes and external buffers', async () => {
    const b = new GltfBuilder();
    (b.json as Json)['nodes'] = [{ name: 'm', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1] }];
    b.view(new Uint8Array(8));
    const c = await parseGlb(b.build());
    const skeleton = skeletonFromGltf(c);
    const clip: BakedClip = {
      ...rawClip(skeleton, 'wave'),
      tracks: [
        {
          node: 0,
          path: 'rotation',
          interpolation: 'LINEAR',
          times: new Float32Array([0, 1]),
          values: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]),
        },
      ],
    };
    await expect(bake(c, skeleton, [clip])).rejects.toMatchObject({ code: 'matrix-node' });
    const e = new GltfBuilder();
    (e.json as Json)['nodes'] = [{ name: 'n' }];
    (e.json as Json)['buffers'] = [{ byteLength: 4, uri: 'model.bin' }];
    const external = await parseGlb(e.build());
    await expect(bake(external, skeletonFromGltf(external), [])).rejects.toMatchObject({ code: 'external-buffer' });
  });

  it('creates buffers[0] for a file without one and removes it again on rollback', async () => {
    const b = new GltfBuilder();
    (b.json as Json)['nodes'] = [{ name: 'root', children: [1] }, { name: 'bone' }];
    const c = await parseGlb(b.build());
    expect(c.bin).toBeNull();
    const skeleton = skeletonFromGltf(c);
    const clip = rawClip({ ...skeleton, nodes: skeleton.nodes.map((n) => ({ ...n, isJoint: true })) }, 'wave');
    const baked = await parseGlb((await bake(c, skeleton, [clip])).bytes);
    expect((baked.json['buffers'] as Json[])[0]?.['byteLength']).toBeGreaterThan(0);
    expect(markerOf(baked).baseBinLength).toBe(0);
    const back = await parseGlb((await bake(baked, skeleton, [])).bytes);
    expect(back.json['buffers']).toBeUndefined();
    expect(back.json['accessors']).toBeUndefined();
  });

  it('appends without rollback (and warns) after another tool or a BIN change', async () => {
    const { source, skeleton } = await setup('polybot.vrm');
    const baked = await parseGlb((await bake(source, skeleton, [rawClip(skeleton, 'wave')])).bytes);
    const foreign = structuredClone(baked.json) as Json;
    const extras = (foreign['asset'] as Json)['extras'] as Json;
    extras['omoba_retarget'] = { ...markerOf(baked), baseAnimations: 1 };
    const tampered = { ...baked, json: foreign as GlbContainer['json'] };
    const appended = await bake(tampered, skeleton, [rawClip(skeleton, 'walk')]);
    expect(appended.lints.map((l) => l.code)).toContain('surgeon.no-rollback');
    expect(animationsOf((await parseGlb(appended.bytes)).json).map((a) => a.name)).toEqual(['wave', 'walk']);

    const bin = baked.bin?.slice() ?? new Uint8Array();
    bin[0] = (bin[0] ?? 0) ^ 0xff;
    const changed = await bake({ ...baked, bin }, skeleton, [rawClip(skeleton, 'walk')]);
    expect(changed.lints.find((l) => l.code === 'surgeon.no-rollback')?.message).toMatch(/BIN bytes changed/);
  });

  it('completes clips with the tracks pre-existing clips animate and warns about the reverse', async () => {
    const b = new GltfBuilder();
    const json = b.json as Json;
    json['nodes'] = [
      { name: 'root', children: [1, 2] },
      { name: 'a', rotation: [0, 0, 0.3826834, 0.9238795] },
      { name: 'b' },
    ];
    json['skins'] = [{ joints: [1, 2] }];
    const times = b.accessor(new Float32Array([0, 1]), 'SCALAR', { minMax: true });
    const values = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0.5, 0.8660254]), 'VEC4');
    json['animations'] = [
      {
        name: 'old',
        samplers: [{ input: times, output: values }],
        channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }],
      },
    ];
    const c = await parseGlb(b.build());
    const skeleton = skeletonFromGltf(c);
    expect([...preexistingTracks(c, skeleton, [])]).toEqual(['1/rotation']);
    expect([...preexistingTracks(c, skeleton, ['OLD'])]).toEqual([]);
    const clip: BakedClip = {
      ...rawClip(skeleton, 'new'),
      tracks: [
        {
          node: 2,
          path: 'rotation',
          interpolation: 'LINEAR',
          times: new Float32Array([0, 1]),
          values: new Float32Array([0, 0, 0, 1, 0, 1, 0, 0]),
        },
      ],
    };
    const artifact = await bake(c, skeleton, [clip]);
    expect(artifact.lints.find((l) => l.code === 'surgeon.preexisting-missing-track')?.message).toMatch(/'old'/);
    const out = await parseGlb(artifact.bytes);
    const written = animationsOf(out.json).find((a) => a.name === 'new');
    expect(written?.channels.map((ch) => ch.target.node)).toEqual([1, 2]);
    const read = readAnimations(out, skeletonFromGltf(out)).find((r) => r.name === 'new');
    expect(Array.from(read?.channels[0]?.values ?? []).map((v) => Number(v.toFixed(6)))).toEqual([
      0, 0, 0.382683, 0.92388, 0, 0, 0.382683, 0.92388,
    ]);
    // The baked file's own clips are not pre-existing for the next bake.
    expect([...preexistingTracks(out, skeleton, [])].sort()).toEqual(['1/rotation']);
  });

  it('refuses humanoid clips and duplicate clip names', async () => {
    const { source, skeleton } = await setup('polybot.vrm');
    const clip = rawClip(skeleton, 'wave');
    await expect(bake(source, skeleton, [{ ...clip, target: 'humanoid' }])).rejects.toMatchObject({
      code: 'unsupported',
    });
    await expect(bake(source, skeleton, [clip, { ...clip, name: 'WAVE' }])).rejects.toMatchObject({
      code: 'unsupported',
    });
  });
});
