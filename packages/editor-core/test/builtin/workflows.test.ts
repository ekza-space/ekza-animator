// Pure parts of the workflows: clip naming rules, provenance (§4.11.6 step 7), import clip options (§4.11.6 step 5),
// clip selection defaults, shot-camera framing, project file names.
import { quatRotateVec3 } from '@ekza-animator/anim-core';
import type { GlbContainer, VrmLicenseInfo } from '@ekza-animator/io';
import { DEFAULT_REDUCE } from '@ekza-animator/rig';
import { describe, expect, it } from 'vitest';
import { frameShotCamera, lookAtQuaternion, SHOT_FOV_Y } from '../../src/workflows/camera';
import { landsOnFrames, resolveClipOptions } from '../../src/workflows/clipWrite';
import { isAnimationOnlyGlb } from '../../src/workflows/importAnimation';
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
  clipProvenance,
  embeddedEkzaProvenance,
  isMixamo,
  isRestrictedLicense,
  sourceProvenance,
} from '../../src/workflows/provenance';
import { SAMPLES } from '../../src/workflows/samples';
import { glbOf } from './support';

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
    expect(sanitizeClipName('Armature|mixamo.com|Layer0')).toBe('Armature_mixamo.com_Layer0');
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

  it('forces Mixamo clips to non-redistributable', () => {
    const source = sourceProvenance({ fileTitle: 'x', sha256: SHA, license: null, known: SAMPLES.polybot.license });
    expect(isMixamo(['Armature|mixamo.com|Layer0'])).toBe(true);
    expect(isMixamo(['Idle', 'mixamorig:Hips'])).toBe(true);
    expect(isMixamo(['Idle'])).toBe(false);
    expect(clipProvenance(source, ['Walk', 'mixamorig:Spine']).redistributable).toBe('no');
    expect(clipProvenance(source, ['Walk'])).toBe(source);
  });

  it('gates baking for restricted VRM licences', () => {
    expect(isRestrictedLicense(null)).toBe(false);
    expect(isRestrictedLicense(license({ modification: 'prohibited' }))).toBe(true);
    expect(isRestrictedLicense(license({ allowRedistribution: false }))).toBe(true);
    expect(isRestrictedLicense(license({ modification: 'allowModification', allowRedistribution: true }))).toBe(false);
  });

  it('reads the provenance the Animator wrote into a VRMA', () => {
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
