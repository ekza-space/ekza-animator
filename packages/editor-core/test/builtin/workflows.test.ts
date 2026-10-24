// Pure parts of the workflows: clip naming rules, provenance (§4.11.6 step 7), import clip options (§4.11.6 step 5),
// clip selection defaults, shot-camera framing, project file names; the export download gate (§4.11.10 step 5).
import { quatRotateVec3 } from '@ekza-studio/anim-core';
import type { CharacterId } from '@ekza-studio/doc';
import {
  type ExportArtifact,
  type ExportRequest,
  type GlbContainer,
  NON_REDISTRIBUTABLE_NAME,
  type ReadBackReport,
  type VrmLicenseInfo,
} from '@ekza-studio/io';
import { DEFAULT_REDUCE } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import type { ExporterDef } from '../../src/types';
import { frameShotCamera, lookAtQuaternion, SHOT_FOV_Y } from '../../src/workflows/camera';
import { landsOnFrames, resolveClipOptions } from '../../src/workflows/clipWrite';
import { blockingLints, READ_BACK_LINT, withReadBackLint } from '../../src/workflows/export';
import { applyClipImport, type ClipImportPlan, isAnimationOnlyGlb } from '../../src/workflows/importAnimation';
import { animationNames, selectClips } from '../../src/workflows/importModel';
import {
  baseName,
  clipNameProblem,
  extensionOf,
  numberedName,
  sanitizeClipName,
  slotProblem,
  tagsProblem,
  uniqueName,
} from '../../src/workflows/names';
import { projectFileName } from '../../src/workflows/project';
import {
  animationAndNodeNames,
  clipProvenance,
  embeddedEkzaProvenance,
  isNonRedistributableSource,
  isRestrictedLicense,
  sourceProvenance,
} from '../../src/workflows/provenance';
import { SAMPLES } from '../../src/workflows/samples';

/** The auto-rigging service's marker in clip and node names (spelled once, in @ekza-studio/io). */
const MARK = NON_REDISTRIBUTABLE_NAME.source;
import { glbOf, opsApp, opsAppWith, WAVE } from './support';

const SHA = 'a'.repeat(64);

function license(fields: Partial<VrmLicenseInfo>): VrmLicenseInfo {
  return {
    title: null,
    authors: [],
    licenseUrl: null,
    allowRedistribution: null,
    modification: null,
    commercialUsage: null,
    creditNotation: null,
    licenseName: null,
    ...fields,
  };
}

function container(json: Record<string, unknown>): GlbContainer {
  return {
    bytes: new Uint8Array(0),
    json: { asset: { version: '2.0' }, ...json },
    jsonByteLength: 0,
    bin: null,
    sha256: SHA,
  };
}

describe('clip names', () => {
  it('validates display names (≤ 64 of [A-Za-z0-9 _.-], no surrounding spaces)', () => {
    expect(clipNameProblem('Idle_Loop 2.v1-final')).toBeNull();
    expect(clipNameProblem('')).not.toBeNull();
    expect(clipNameProblem(' idle')).not.toBeNull();
    expect(clipNameProblem('idle/loop')).not.toBeNull();
    expect(clipNameProblem('x'.repeat(65))).not.toBeNull();
    expect(clipNameProblem(42)).not.toBeNull();
  });

  it('sanitizes, uniquifies (ignoring case) and numbers names', () => {
    expect(sanitizeClipName('Armature|example.com|Layer0')).toBe('Armature_example.com_Layer0');
    expect(sanitizeClipName('  //  ')).toBe('_');
    expect(sanitizeClipName('')).toBe('clip');
    expect(sanitizeClipName('a'.repeat(80))).toHaveLength(64);
    expect(uniqueName('Idle', ['idle', 'IDLE 2'])).toBe('Idle 3');
    expect(uniqueName('x'.repeat(64), ['x'.repeat(64)])).toBe(`${'x'.repeat(62)} 2`);
    expect(numberedName('clip', ['clip1', 'Clip2', 'wave'])).toBe('clip3');
  });

  it('checks slots against vocabulary v1 and tags', () => {
    expect(slotProblem(null)).toBeNull();
    expect(slotProblem('wave')).toBeNull();
    expect(slotProblem('tpose')).toMatch(/reserved/);
    expect(slotProblem('moonwalk')).toMatch(/Unknown slot/);
    expect(tagsProblem(['emote', 'a_b-1'])).toBeNull();
    expect(tagsProblem(['Emote'])).not.toBeNull();
    expect(tagsProblem(['a', 'a'])).not.toBeNull();
    expect(tagsProblem(Array.from({ length: 9 }, (_, i) => `t${i}`))).not.toBeNull();
  });

  it('splits file names', () => {
    expect(baseName('dir/Seed-san.vrm')).toBe('Seed-san');
    expect(baseName('scene.ekzanim.json')).toBe('scene');
    expect(extensionOf('A.VRM')).toBe('vrm');
    expect(extensionOf('scene.ekzanim.json')).toBe('ekzanim.json');
    expect(extensionOf('README')).toBe('');
    expect(projectFileName('My Scene', 'ekzanim')).toBe('My Scene.ekzanim');
    expect(projectFileName('a/b:c.ekzanim', 'ekzanim')).toBe('b_c.ekzanim');
    expect(projectFileName('walk.v2', 'ekzanim')).toBe('walk.v2.ekzanim');
    expect(projectFileName('scene.ekzanim.json', 'ekzanim.json')).toBe('scene.ekzanim.json');
    expect(projectFileName('scene.ekzanim', 'ekzanim.json')).toBe('scene.ekzanim.json');
  });
});

describe('provenance', () => {
  it('inherits VRM meta: title, authors, licence and redistribution', () => {
    const p = sourceProvenance({
      fileTitle: 'seed-san',
      sha256: SHA,
      license: license({
        title: 'Seed-san',
        authors: ['VirtualCast, Inc.'],
        licenseName: 'LicenseRef-VRM-PL-1.0',
        allowRedistribution: true,
      }),
    });
    expect(p).toEqual({
      derivedFrom: [
        { title: 'Seed-san', author: 'VirtualCast, Inc.', license: 'LicenseRef-VRM-PL-1.0', sourceSha256: SHA },
      ],
      redistributable: 'yes',
    });
    const forbidden = sourceProvenance({
      fileTitle: 'x',
      sha256: SHA,
      license: license({ title: 'undefined', authors: ['undefined'], allowRedistribution: false }),
    });
    expect(forbidden).toEqual({
      derivedFrom: [{ title: 'x', author: 'unknown', license: 'unknown', sourceSha256: SHA }],
      redistributable: 'no',
    });
  });

  it("marks files without licence data 'unknown' and passes known sample licences", () => {
    expect(sourceProvenance({ fileTitle: 'ual', sha256: SHA, license: null }).redistributable).toBe('unknown');
    const known = sourceProvenance({
      fileTitle: 'ual',
      sha256: SHA,
      license: null,
      known: SAMPLES['quaternius-ual'].license,
    });
    expect(known).toEqual({
      derivedFrom: [
        { title: 'Universal Animation Library', author: 'Quaternius', license: 'CC0-1.0', sourceSha256: SHA },
      ],
      redistributable: 'yes',
    });
  });

  it("forces the auto-rigging service's clips to non-redistributable", () => {
    const source = sourceProvenance({ fileTitle: 'x', sha256: SHA, license: null, known: SAMPLES.polybot.license });
    expect(isNonRedistributableSource([`Armature|${MARK}.com|Layer0`])).toBe(true);
    expect(isNonRedistributableSource(['Idle', `${MARK}rig:Hips`])).toBe(true);
    expect(isNonRedistributableSource(['Idle'])).toBe(false);
    expect(clipProvenance(source, ['Walk', `${MARK}rig:Spine`]).redistributable).toBe('no');
    expect(clipProvenance(source, ['Walk'])).toBe(source);
  });

  it('lists every animation and node name of a file for the auto-rigging-service rule (VRMA import)', () => {
    const file = container({
      animations: [{ name: `Armature|${MARK}.com|Layer0` }, {}],
      nodes: [{ name: 'Hips' }, { name: `${MARK}rig:Spine` }, { mesh: 0 }],
    });
    expect(animationAndNodeNames(file)).toEqual([`Armature|${MARK}.com|Layer0`, 'Hips', `${MARK}rig:Spine`]);
    expect(animationAndNodeNames(container({ animations: 'bad', nodes: [null, 3] }))).toEqual([]);
    const unknown = sourceProvenance({ fileTitle: 'clip', sha256: SHA, license: null });
    expect(clipProvenance(unknown, ['clip', ...animationAndNodeNames(file)]).redistributable).toBe('no');
    const clean = container({ animations: [{ name: 'wave' }], nodes: [{ name: 'Hips' }] });
    expect(clipProvenance(unknown, ['wave', ...animationAndNodeNames(clean)]).redistributable).toBe('unknown');
  });

  it('gates baking for restricted VRM licences', () => {
    expect(isRestrictedLicense(null)).toBe(false);
    expect(isRestrictedLicense(license({ modification: 'prohibited' }))).toBe(true);
    expect(isRestrictedLicense(license({ allowRedistribution: false }))).toBe(true);
    expect(isRestrictedLicense(license({ modification: 'allowModification', allowRedistribution: true }))).toBe(false);
  });

  it('reads the provenance the editor wrote into a VRMA', () => {
    const meta = {
      schema: 1,
      clips: [
        {
          derivedFrom: [
            { title: 'Seed-san', author: 'VirtualCast, Inc.', license: 'LicenseRef-VRM-PL-1.0', sourceSha256: SHA },
          ],
          redistributable: 'yes',
        },
      ],
    };
    expect(
      embeddedEkzaProvenance(container({ asset: { version: '2.0', extras: { ekza_animation_v1: meta } } })),
    ).toEqual({
      derivedFrom: meta.clips[0]?.derivedFrom,
      redistributable: 'yes',
    });
    expect(embeddedEkzaProvenance(container({}))).toBeNull();
    const bad = { ...meta, clips: [{ derivedFrom: [{ title: 1 }], redistributable: 'yes' }] };
    expect(
      embeddedEkzaProvenance(container({ asset: { version: '2.0', extras: { ekza_animation_v1: bad } } })),
    ).toBeNull();
  });
});

describe('import clip options (§4.11.6 step 5)', () => {
  const base = {
    name: 'Idle',
    sceneFps: { num: 30, den: 1 },
    clipFps: undefined,
    keyMode: undefined,
    eulerFilter: undefined,
    reduce: undefined,
    reducePref: 'auto' as const,
    defaultReduce: DEFAULT_REDUCE,
    maxChannelKeys: 61,
    duration: 2.5,
  };

  it('keeps the detected rate and its key times; reduces dense clips by default', () => {
    const r = resolveClipOptions({ ...base, detected: { num: 24, den: 1 } });
    expect(r).toEqual({
      fps: { num: 24, den: 1 },
      keyMode: 'source-times',
      eulerFilter: true,
      reduce: DEFAULT_REDUCE,
      warnings: [],
    });
    expect(resolveClipOptions({ ...base, detected: { num: 24, den: 1 }, maxChannelKeys: 4 }).reduce).toBeNull();
  });

  it('resamples at the scene rate when no rate is detected, or when source times miss whole frames', () => {
    expect(resolveClipOptions({ ...base, detected: null })).toMatchObject({
      fps: { num: 30, den: 1 },
      keyMode: 'resample',
    });
    expect(resolveClipOptions({ ...base, detected: { num: 24, den: 1 }, clipFps: { num: 30, den: 1 } }).keyMode).toBe(
      'resample',
    );
    expect(resolveClipOptions({ ...base, detected: { num: 24, den: 1 }, clipFps: { num: 48, den: 1 } }).keyMode).toBe(
      'source-times',
    );
    const forced = resolveClipOptions({ ...base, detected: null, keyMode: 'source-times' });
    expect(forced.warnings[0]).toMatch(/sub-frame/);
  });

  it('follows the reduce preference unless the option says otherwise', () => {
    expect(resolveClipOptions({ ...base, detected: null, reducePref: 'never' }).reduce).toBeNull();
    expect(resolveClipOptions({ ...base, detected: null, maxChannelKeys: 2, reducePref: 'always' }).reduce).toBe(
      DEFAULT_REDUCE,
    );
    expect(resolveClipOptions({ ...base, detected: null, reduce: null }).reduce).toBeNull();
    expect(landsOnFrames({ num: 30, den: 1 }, { num: 60, den: 1 })).toBe(true);
    expect(landsOnFrames({ num: 60, den: 1 }, { num: 30, den: 1 })).toBe(false);
  });

  it('selects embedded clips: the option, the sample default, else all when there are at most 8', () => {
    const warnings: string[] = [];
    const nine = Array.from({ length: 9 }, (_, i) => `clip${i}`);
    expect(selectClips(nine.slice(0, 3), undefined, undefined, warnings)).toEqual([0, 1, 2]);
    expect(selectClips(nine, undefined, undefined, warnings)).toEqual([]);
    expect(selectClips(nine, undefined, 'clip4', warnings)).toEqual([4]);
    expect(selectClips(nine, 'all', 'clip4', warnings)).toHaveLength(9);
    expect(selectClips(nine, 'none', undefined, warnings)).toEqual([]);
    expect(selectClips(nine, [7, 2, 2, 12], undefined, warnings)).toEqual([2, 7]);
    expect(warnings).toEqual(['The file has no animation 12; skipped']);
    expect(animationNames(container({ animations: [{ name: 'Idle' }, {}] }))).toEqual(['Idle', 'animation_1']);
  });
});

describe('animation-only GLB detection', () => {
  it('needs GLB magic, a JSON chunk, animations and no skin', () => {
    expect(isAnimationOnlyGlb(glbOf({ asset: { version: '2.0' }, animations: [{}] }))).toBe(true);
    expect(isAnimationOnlyGlb(glbOf({ asset: { version: '2.0' }, skins: [], animations: [{}] }))).toBe(true);
    expect(isAnimationOnlyGlb(glbOf({ asset: { version: '2.0' }, skins: [{}], animations: [{}] }))).toBe(false);
    expect(isAnimationOnlyGlb(glbOf({ asset: { version: '2.0' }, animations: [] }))).toBe(false);
    const broken = glbOf({ asset: { version: '2.0' }, animations: [{}] });
    broken[20] = 0x5b;
    expect(isAnimationOnlyGlb(broken)).toBe(false);
    expect(isAnimationOnlyGlb(new TextEncoder().encode('glTF but not really'))).toBe(false);
  });
});

describe('shot camera framing', () => {
  it('looks at the character from a 3/4 front view at chest height with a 50 mm lens', () => {
    const frame = frameShotCamera(1.6, 0);
    expect(SHOT_FOV_Y).toBeCloseTo(2 * Math.atan(12 / 50), 12);
    expect(frame.position[1]).toBeCloseTo(1.6 * 0.72, 12);
    expect(frame.position[2]).toBeGreaterThan(0);
    expect(frame.position[0]).toBeGreaterThan(0);
    // The camera's −Z axis points at the target.
    const forward = quatRotateVec3(frame.quaternion, [0, 0, -1]);
    const to = frame.target.map((v, i) => v - (frame.position[i] as number));
    const length = Math.hypot(...to);
    forward.forEach((v, i) => expect(v).toBeCloseTo((to[i] as number) / length, 9));
    // Up stays up (no roll).
    expect(quatRotateVec3(frame.quaternion, [1, 0, 0])[1]).toBeCloseTo(0, 12);
    // The whole height fits the vertical field of view.
    expect(Math.atan2(1.6 * 0.55, length)).toBeLessThanOrEqual(SHOT_FOV_Y / 2 + 1e-9);
  });

  it('handles a camera straight above its target', () => {
    const q = lookAtQuaternion([0, 2, 0], [0, 0, 0]);
    const forward = quatRotateVec3(q, [0, 0, -1]);
    expect(forward[1]).toBeCloseTo(-1, 12);
  });
});

describe('clip import apply', () => {
  it('refuses to write clips for a character removed while the file was read', () => {
    const app = opsApp();
    const plan = {
      character: 'chr_Removed000000001' as CharacterId,
      asset: {
        id: 'a'.repeat(64),
        name: 'x.vrma',
        ext: 'vrma',
        mime: 'model/gltf-binary',
        size: 0,
        role: 'animation-source',
      },
      clips: [],
      warnings: [],
    } as unknown as ClipImportPlan;
    expect(() => app.store.transact({ label: 'x' }, (tx) => applyClipImport(app, tx, plan))).toThrow(
      /removed while the file was being read/,
    );
  });
});

describe('export download gate (§4.11.10 step 5)', () => {
  const READ_BACK_OK: ReadBackReport = {
    ok: true,
    animations: 1,
    channels: 3,
    maxRotationErrorRad: 1e-7,
    maxTranslationErrorM: 0,
  };

  function artifact(fileName: string, readBack: ReadBackReport | null): ExportArtifact {
    return {
      kind: 'animation-glb',
      fileName,
      mime: 'model/gltf-binary',
      bytes: new Uint8Array([1, 2, 3, 4]),
      sha256: SHA,
      lints: [{ code: 'bake.large-rotation-step', severity: 'warning', message: 'large step' }],
      readBack,
      validation: null,
      stats: { clips: 1, channels: 3, keys: 6 },
    };
  }

  const REQUEST: ExportRequest = {
    kind: 'animation-glb',
    character: WAVE.character,
    clips: [WAVE.clip],
    fileNamePattern: '{character}_{clip}',
    closeLoop: true,
    includeConstantTracks: true,
    acknowledgeLicense: false,
    profile: null,
  };

  /** The fake app with a custom `animation-glb` exporter that returns the given artifacts. */
  function appExporting(artifacts: readonly ExportArtifact[]) {
    const { app, services } = opsAppWith();
    const exporter: ExporterDef = {
      id: 'animation-glb',
      label: 'Test GLB',
      extension: () => 'glb',
      poll: () => true,
      run: () => Promise.resolve(artifacts),
    };
    app.exporters.register(exporter);
    return { app, services };
  }

  it('turns a failed read-back into an error lint, once', () => {
    const failed = withReadBackLint(
      artifact('broken.glb', { ...READ_BACK_OK, ok: false, maxRotationErrorRad: 0.25, maxTranslationErrorM: 0.002 }),
    );
    expect(blockingLints(failed)).toEqual([
      {
        code: READ_BACK_LINT,
        severity: 'error',
        message:
          'Read-back check failed: max rotation error 0.250 rad, max translation error 0.00200 m (1 animation, 3 channels read)',
      },
    ]);
    expect(withReadBackLint(failed)).toBe(failed);
    const passed = artifact('fine.glb', READ_BACK_OK);
    expect(withReadBackLint(passed)).toBe(passed);
    const unchecked = artifact('unchecked.glb', null);
    expect(withReadBackLint(unchecked)).toBe(unchecked);
    // Counts take the right number (acceptance: "1 clips"): one channel reads "1 channel", not "1 channels".
    const single = withReadBackLint(
      artifact('one.glb', { ...READ_BACK_OK, ok: false, animations: 2, channels: 1, maxRotationErrorRad: 0.25 }),
    );
    expect(blockingLints(single)[0]?.message).toMatch(/\(2 animations, 1 channel read\)$/);
  });

  it('does not download an artifact whose read-back failed, and says so', async () => {
    const broken = artifact('broken.glb', { ...READ_BACK_OK, ok: false, maxRotationErrorRad: 0.25 });
    const { app, services } = appExporting([broken]);
    const result = await app.runUntyped('file.export', REQUEST);
    expect(result.status).toBe('finished');
    const returned = (result.status === 'finished' ? result.value : []) as readonly ExportArtifact[];
    expect(returned).toHaveLength(1);
    expect(returned[0]?.lints.map((lint) => lint.code)).toEqual(['bake.large-rotation-step', READ_BACK_LINT]);
    expect(services.downloads).toEqual([]);
    expect(services.toasts).toHaveLength(1);
    expect(services.toasts[0]).toMatchObject({ kind: 'error' });
    expect(services.toasts[0]?.text).toMatch(/^broken\.glb was not saved: Read-back check failed/);
    expect(app.session.getState().busy).toBeNull();
  });

  it('downloads the artifacts that pass and reports their warnings', async () => {
    const good = artifact('good.glb', READ_BACK_OK);
    const broken = artifact('broken.glb', { ...READ_BACK_OK, ok: false });
    const { app, services } = appExporting([good, broken]);
    expect((await app.runUntyped('file.export', REQUEST)).status).toBe('finished');
    expect(services.downloads.map((d) => d.fileName)).toEqual(['good.glb']);
    expect(services.toasts.map((toast) => toast.kind)).toEqual(['error', 'warning']);
    expect(services.toasts[1]?.text).toBe('Exported good.glb with 1 warning');
  });
});
