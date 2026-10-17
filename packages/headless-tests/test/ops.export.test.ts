// ops.* (WP-7b): export through `file.export` and the built-in exporters (MVP-SPEC §4.11.10, §4.11.13): bake into
// the model (surgeon), VRMA and animation-only GLB on the fixtures, the validation policy, metadata, the licence gate,
// profile preflight, self-contained multi-clip files, downloads and round trips back into the editor.
import { quatAngle, quatSlerp } from '@ekza-animator/anim-core';
import type { CharacterId, ClipId, ControlId } from '@ekza-animator/doc';
import { readFixture } from '@ekza-animator/doc/testing';
import type { EditorApp, ImportResult } from '@ekza-animator/editor-core';
import {
  compareValidation,
  type ExportArtifact,
  type ExportRequest,
  type GlbContainer,
  parseGlb,
  readAnimations,
  skeletonFromGltf,
} from '@ekza-animator/io';
import { describe, expect, it } from 'vitest';
import {
  BLOCKED,
  importFixture,
  realApp,
  runOk,
  runtimeOf,
  SIBLINGS_READY,
  setSceneFrame,
  validate,
} from './ops.support';

const DEG = Math.PI / 180;

function request(character: CharacterId, clips: readonly ClipId[], fields?: Partial<ExportRequest>): ExportRequest {
  return {
    kind: 'bake-into-model',
    character,
    clips,
    fileNamePattern: '{character}_{clip}',
    closeLoop: true,
    includeConstantTracks: true,
    acknowledgeLicense: false,
    profile: null,
    ...fields,
  };
}

function controlOf(app: EditorApp, character: CharacterId, key: string): ControlId {
  const rig = app.store.query.rigOfCharacter(character);
  const control = rig === undefined ? undefined : app.store.query.controlByKey(rig.id, key);
  if (control === undefined) throw new Error(`no control ${key}`);
  return control.id;
}

/** A new clip `name` with `fk.lowerArm.L` rz keyed 30/−30/30° at frames 0/15/30 (E2E-16). */
async function waveClip(app: EditorApp, character: CharacterId, name = 'wave', key = 'fk.lowerArm.L'): Promise<ClipId> {
  const clip = ((await runOk(app, 'clip.new', { character, name, range: { start: 0, end: 30 } })) as { clip: ClipId })
    .clip;
  const control = controlOf(app, character, key);
  for (const [frame, degrees] of [
    [0, 30],
    [15, -30],
    [30, 30],
  ] as const) {
    setSceneFrame(app, frame);
    await runOk(app, 'channel.setValues', { edits: [{ control, channel: 'rz', value: degrees * DEG }], key: 'force' });
  }
  return clip;
}

async function exportOk(app: EditorApp, req: ExportRequest): Promise<readonly ExportArtifact[]> {
  return (await runOk(app, 'file.export', req)) as readonly ExportArtifact[];
}

function animationNames(c: GlbContainer): string[] {
  const animations = c.json['animations'];
  return Array.isArray(animations) ? (animations as { name?: string }[]).map((a) => a.name ?? '') : [];
}

/** (node, path) targets of an animation in a glTF file. */
function targets(c: GlbContainer, index: number): string[] {
  const animation = (c.json['animations'] as { channels: { target: { node: number; path: string } }[] }[])[index];
  return (animation?.channels ?? []).map((ch) => `${ch.target.node}/${ch.target.path}`).sort();
}

/** Repacks a GLB with an edited JSON chunk (BIN unchanged). */
function withJson(c: GlbContainer, edit: (json: Record<string, unknown>) => void): Uint8Array {
  const json = JSON.parse(JSON.stringify(c.json)) as Record<string, unknown>;
  edit(json);
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const bin = c.bin ?? new Uint8Array(0);
  const total = 12 + 8 + jsonBytes.length + (bin.length > 0 ? 8 + bin.length : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  if (bin.length > 0) {
    const at = 20 + jsonBytes.length;
    view.setUint32(at, bin.length, true);
    view.setUint32(at + 4, 0x004e4942, true);
    out.set(bin, at + 8);
  }
  return out;
}

describe.skipIf(!SIBLINGS_READY)(`file.export ${BLOCKED}`, { timeout: 120_000 }, () => {
  it('bakes a clip into Seed-san: no new validator errors, original BIN and VRM block kept, re-imports (E2E-16)', async () => {
    const { app, services } = realApp();
    const seed = await importFixture(app, 'seed-san.vrm');
    const wave = await waveClip(app, seed.character);
    const steps = app.history.peekUndo()?.id;
    const [artifact, ...rest] = await exportOk(app, request(seed.character, [wave]));
    expect(rest).toEqual([]);
    if (artifact === undefined) throw new Error('no artifact');
    expect(app.history.peekUndo()?.id).toBe(steps);
    expect(artifact.fileName).toBe('Seed-san_wave.vrm');
    expect(artifact.mime).toBe('model/gltf-binary');
    expect(services.downloads.map((d) => d.fileName)).toEqual(['Seed-san_wave.vrm']);
    expect(services.toasts.at(-1)?.kind).toMatch(/success|warning/);
    expect(artifact.lints.filter((l) => l.severity === 'error')).toEqual([]);
    expect(artifact.readBack?.ok).toBe(true);

    const sourceBytes = readFixture('seed-san.vrm');
    expect(artifact.validation).not.toBeNull();
    expect(compareValidation(await validate(sourceBytes), artifact.validation as never)).toEqual([]);
    const source = await parseGlb(sourceBytes);
    const output = await parseGlb(artifact.bytes);
    const baseLength = (source.json['buffers'] as { byteLength: number }[])[0]?.byteLength ?? 0;
    expect(output.bin?.subarray(0, baseLength)).toEqual(source.bin?.subarray(0, baseLength));
    expect((output.json['extensions'] as Record<string, unknown>)['VRMC_vrm']).toEqual(
      (source.json['extensions'] as Record<string, unknown>)['VRMC_vrm'],
    );
    expect(animationNames(output)).toEqual(['wave']);
    const meta = (output.json.asset.extras?.['ekza_animation_v1'] ?? {}) as { clips: { name: string; fps: number }[] };
    expect(meta.clips.map((c) => [c.name, c.fps])).toEqual([['wave', 30]]);

    // Reload the file in the editor: the clip comes back with rz(15) = −30°.
    const again = realApp().app;
    const back = (await runOk(again, 'file.importModel', {
      name: artifact.fileName,
      bytes: artifact.bytes,
      options: { clips: 'all', reduce: null },
    })) as ImportResult;
    await runtimeOf(again, back.character);
    const clip = again.store.get('clips', back.clips[0] as ClipId);
    expect(clip?.name).toBe('wave');
    setSceneFrame(again, 15);
    expect(again.evaluation.channelValues(controlOf(again, back.character, 'fk.lowerArm.L')).rz).toBeCloseTo(
      -30 * DEG,
      4,
    );
  });

  it('bakes an edited Idle_Loop back into the UAL file in place (generic GLB surgeon)', async () => {
    const { app } = realApp();
    const ual = await importFixture(app, 'quaternius-ual.glb', { clips: [9] });
    const clip = ual.clips[0] as ClipId;
    const rig = app.store.query.rigOfCharacter(ual.character);
    const first = app.store.query.controlsOfRig(rig?.id as never)[3];
    setSceneFrame(app, 12);
    await runOk(app, 'channel.setValues', { edits: [{ control: first?.id, channel: 'rz', value: 0.4 }], key: 'force' });
    const [artifact] = await exportOk(app, request(ual.character, [clip], { fileNamePattern: '{character}_edit' }));
    if (artifact === undefined) throw new Error('no artifact');
    expect(artifact.fileName).toBe('quaternius-ual_edit.glb');
    const sourceBytes = readFixture('quaternius-ual.glb');
    expect(compareValidation(await validate(sourceBytes), artifact.validation as never)).toEqual([]);
    const output = await parseGlb(artifact.bytes);
    const names = animationNames(output);
    expect(names).toHaveLength(46);
    expect(names[9]).toBe('Idle_Loop');
    expect(names).toEqual(animationNames(await parseGlb(sourceBytes)));
  });

  it('writes self-contained clips when several are baked together', async () => {
    const { app } = realApp();
    const bot = await importFixture(app, 'polybot.vrm');
    const wave = await waveClip(app, bot.character, 'wave');
    const nod = await waveClip(app, bot.character, 'nod', 'fk.head');
    const [artifact] = await exportOk(app, request(bot.character, [wave, nod]));
    if (artifact === undefined) throw new Error('no artifact');
    expect(artifact.fileName).toBe('Polybot_wave-nod.vrm');
    const output = await parseGlb(artifact.bytes);
    expect(animationNames(output)).toEqual(['wave', 'nod']);
    expect(targets(output, 0)).toEqual(targets(output, 1));
  });

  it('exports VRMA that validates and imports back onto the character (round trip < 1e-4 rad)', async () => {
    const { app } = realApp();
    const seed = await importFixture(app, 'seed-san.vrm');
    const wave = await waveClip(app, seed.character);
    const [vrma] = await exportOk(app, request(seed.character, [wave], { kind: 'vrma' }));
    if (vrma === undefined) throw new Error('no artifact');
    expect(vrma.fileName).toBe('Seed-san_wave.vrma');
    expect(vrma.validation?.errors).toBe(0);
    const parsed = await parseGlb(vrma.bytes);
    expect(parsed.json['extensionsUsed']).toContain('VRMC_vrm_animation');

    const imported = (await runOk(app, 'file.importAnimation', {
      name: vrma.fileName,
      bytes: vrma.bytes,
      options: { reduce: null },
    })) as { clips: ClipId[] };
    const back = imported.clips[0] as ClipId;
    expect(app.store.get('clips', back)).toMatchObject({
      name: 'wave 2',
      fps: { num: 30, den: 1 },
      source: { kind: 'imported', fileName: 'Seed-san_wave.vrma' },
      provenance: { redistributable: 'yes' },
    });
    expect(app.session.getState().activeClip[seed.character]).toBe(back);
    const runtime = await runtimeOf(app, seed.character);
    const a = runtime.program.allocPose();
    const b = runtime.program.allocPose();
    let worst = 0;
    for (let frame = 0; frame <= 30; frame++) {
      app.evaluation.evaluateAt(seed.character, wave, frame, a, { withOverrides: false });
      app.evaluation.evaluateAt(seed.character, back, frame, b, { withOverrides: false });
      for (let bone = 0; bone < 55; bone++) {
        const q = (p: Float64Array) =>
          [p[bone * 4], p[bone * 4 + 1], p[bone * 4 + 2], p[bone * 4 + 3]] as [number, number, number, number];
        worst = Math.max(worst, quatAngle(q(a.humanLocal), q(b.humanLocal)));
      }
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it('exports an animation-only GLB of UAL Idle_Loop that re-reads to the editor pose (E2E-18)', async () => {
    const { app } = realApp();
    const ual = await importFixture(app, 'quaternius-ual.glb', { clips: [9] });
    const clip = ual.clips[0] as ClipId;
    const [glb] = await exportOk(app, request(ual.character, [clip], { kind: 'animation-glb' }));
    if (glb === undefined) throw new Error('no artifact');
    expect(app.store.get('characters', ual.character)?.name).toBe('quaternius-ual');
    expect(glb.fileName).toBe('quaternius-ual_Idle_Loop.glb');
    expect(glb.validation?.errors).toBe(0);
    const output = await parseGlb(glb.bytes);
    expect(output.json['meshes']).toBeUndefined();
    expect(output.json['skins']).toBeUndefined();
    const skeleton = skeletonFromGltf(output);
    const [raw] = readAnimations(output, skeleton);
    if (raw === undefined) throw new Error('no animation');
    const runtime = ual.runtime;
    const pose = runtime.program.allocPose();
    app.evaluation.evaluateAt(ual.character, clip, 10, pose, { withOverrides: false });
    const byName = new Map(runtime.skeleton.nodes.map((node) => [node.name, node.index]));
    let worst = 0;
    for (const channel of raw.channels) {
      if (channel.path !== 'rotation') continue;
      const node = byName.get(skeleton.nodes[channel.node]?.name ?? '');
      if (node === undefined) continue;
      const v = sampleRotation(channel.times, channel.values, 10 / 24);
      const l = pose.boneLocal.subarray(node * 10 + 3, node * 10 + 7);
      worst = Math.max(worst, quatAngle(v, [l[0], l[1], l[2], l[3]] as [number, number, number, number]));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it('gates baking into a model whose licence forbids modification', async () => {
    const { app } = realApp();
    const source = await parseGlb(readFixture('polybot.vrm'));
    const bytes = withJson(source, (json) => {
      const vrm = (json['extensions'] as { VRM: { meta: Record<string, unknown> } }).VRM;
      vrm.meta['licenseName'] = 'CC_BY_ND';
    });
    const result = (await runOk(app, 'file.importModel', { name: 'nd.vrm', bytes })) as ImportResult;
    expect(result.warnings.some((w) => w.includes('acknowledgement'))).toBe(true);
    await runtimeOf(app, result.character);
    const wave = await waveClip(app, result.character);
    const refused = await app.runUntyped('file.export', request(result.character, [wave]));
    expect(refused.status).toBe('cancelled');
    expect(await exportOk(app, request(result.character, [wave], { acknowledgeLicense: true }))).toHaveLength(1);
    // VRMA is always allowed.
    expect(await exportOk(app, request(result.character, [wave], { kind: 'vrma' }))).toHaveLength(1);
  });

  it('runs the profile preflight: slot names, provenance and required clips under Ekza profiles', async () => {
    const { app } = realApp();
    const bot = await importFixture(app, 'polybot.vrm');
    const wave = await waveClip(app, bot.character, 'Wave Clip');
    const space = request(bot.character, [wave], { profile: 'ekza/space-avatar-v1' });
    expect(await app.runUntyped('file.export', space)).toMatchObject({ status: 'cancelled' });
    await runOk(app, 'clip.setSettings', { clip: wave, slot: 'wave' });
    expect(await exportOk(app, space)).toHaveLength(1);
    await runOk(app, 'clip.setSettings', { clip: wave, provenance: { redistributable: 'no' } });
    expect(await app.runUntyped('file.export', space)).toMatchObject({ status: 'cancelled' });
    // Locally the same clip exports (with a warning).
    expect(await exportOk(app, request(bot.character, [wave]))).toHaveLength(1);
    const omoba = await app.runUntyped('file.export', { ...space, profile: 'ekza/omoba-humanoid-v1' });
    expect(omoba).toMatchObject({ status: 'cancelled' });
    expect(await app.runUntyped('file.export', { ...space, profile: 'ekza/vrma-humanoid-v1' })).toMatchObject({
      status: 'cancelled',
    });
    expect(await app.runUntyped('file.export', { ...space, profile: 'nope' })).toMatchObject({ status: 'cancelled' });
  });

  it('refuses clips of another character, unknown kinds and VRMA of generic rigs', async () => {
    const { app } = realApp();
    const bot = await importFixture(app, 'polybot.vrm');
    const ual = await importFixture(app, 'quaternius-ual.glb', { clips: [9] });
    const wave = await waveClip(app, bot.character);
    expect(await app.runUntyped('file.export', request(ual.character, [wave]))).toMatchObject({ status: 'cancelled' });
    expect(await app.runUntyped('file.export', request(bot.character, []))).toMatchObject({ status: 'cancelled' });
    expect(await app.runUntyped('file.export', request(bot.character, [wave], { kind: 'fbx' }))).toMatchObject({
      status: 'cancelled',
    });
    expect(await app.runUntyped('file.export', request(ual.character, ual.clips, { kind: 'vrma' }))).toMatchObject({
      status: 'cancelled',
    });
    expect(await app.runUntyped('file.export', { kind: 'vrma' })).toMatchObject({ status: 'cancelled' });
  });

  it('imports a Mixamo-named VRMA as non-redistributable, which the Ekza VRMA profile refuses (ADR 0010 §3)', async () => {
    const { app } = realApp();
    const bot = await importFixture(app, 'polybot.vrm');
    const wave = await waveClip(app, bot.character);
    const [vrma] = await exportOk(app, request(bot.character, [wave], { kind: 'vrma' }));
    if (vrma === undefined) throw new Error('no artifact');
    const source = await parseGlb(vrma.bytes);
    /** The VRMA without the Animator's provenance, so the import judges it by its names. */
    const foreign = (edit: (json: Record<string, unknown>) => void) =>
      withJson(source, (json) => {
        const asset = json['asset'] as { extras?: Record<string, unknown> };
        delete asset.extras;
        edit(json);
      });
    const importAs = async (name: string, bytes: Uint8Array) => {
      const result = (await runOk(app, 'file.importAnimation', { name, bytes, character: bot.character })) as {
        clips: ClipId[];
      };
      const id = result.clips[0] as ClipId;
      await runOk(app, 'clip.setSettings', { clip: id, slot: 'idle' });
      return id;
    };
    const plain = await importAs(
      'plain.vrma',
      foreign(() => {}),
    );
    const byClip = await importAs(
      'mixamo-clip.vrma',
      foreign((json) => {
        (json['animations'] as { name?: string }[])[0] = {
          ...(json['animations'] as Record<string, unknown>[])[0],
          name: 'Armature|mixamo.com|Layer0',
        };
      }),
    );
    const byNode = await importAs(
      'mixamo-node.vrma',
      foreign((json) => {
        const nodes = json['nodes'] as { name?: string }[];
        nodes[0] = { ...nodes[0], name: 'mixamorig:Hips' };
      }),
    );
    expect(app.store.get('clips', plain)?.provenance.redistributable).toBe('unknown');
    expect(app.store.get('clips', byClip)?.provenance.redistributable).toBe('no');
    expect(app.store.get('clips', byNode)?.provenance.redistributable).toBe('no');

    const profile = 'ekza/vrma-humanoid-v1';
    expect(await exportOk(app, request(bot.character, [plain], { kind: 'vrma', profile }))).toHaveLength(1);
    for (const clip of [byClip, byNode]) {
      const refused = await app.runUntyped('file.export', request(bot.character, [clip], { kind: 'vrma', profile }));
      expect(refused).toMatchObject({ status: 'cancelled' });
      expect(refused.status === 'cancelled' ? refused.reason : '').toMatch(/not redistributable/);
    }
  });
});

/** LINEAR rotation sampler value at `t` seconds (slerp between the surrounding keys). */
function sampleRotation(times: Float32Array, values: Float32Array, t: number): [number, number, number, number] {
  const q = (i: number): [number, number, number, number] => [
    values[i * 4] as number,
    values[i * 4 + 1] as number,
    values[i * 4 + 2] as number,
    values[i * 4 + 3] as number,
  ];
  let k = 0;
  while (k < times.length - 2 && (times[k + 1] as number) <= t) k++;
  const t0 = times[k] as number;
  const t1 = times[k + 1] ?? t0;
  const alpha = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  return quatSlerp(q(k), q(Math.min(k + 1, times.length - 1)), alpha);
}
