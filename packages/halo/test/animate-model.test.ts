// The Animate stage's pure parts (STUDIO-TOUCH-SPEC §10; T7): the Animations row's chips folded to the visible-target
// budget, + New's arguments (whole frames of 1, 2 or 4 s), the fitting manipulator (a turn ring for FK controls, move
// for IK goals and the root) and the controls that Reach, on Polybot; the Thread's strip geometry, beat ticks on whole
// frames, the dot under a finger and the Blend chip's keys; the Library's kinds, search, trim and calls; Reach's plane
// math; the channel labels' values (Pro's numbers, P14).
import type { ClipRecord } from '@ekza-studio/doc';
import { VIEWPORT_TOOL } from '@ekza-studio/editor-core';
import { describe, expect, it } from 'vitest';
import { channelChips, shownValue, storedValue } from '../src/i18n/channels';
import {
  addCall,
  filterLibrary,
  IDENTITY_PARAMS,
  isIdentity,
  kindOf,
  matches,
  starterCalls,
  trimOf,
} from '../src/sheets/library/model';
import {
  cleanClipName,
  fittingTool,
  framesOf,
  loopItCall,
  newAnimationCall,
  nextAnimationName,
  reachLimbOf,
  rowChips,
  swapSidesCalls,
} from '../src/stages/animate/model';
import { planePoint, rotate, toCharacter, toScene } from '../src/stages/animate/reach';
import {
  beatTicks,
  between,
  dotAt,
  frameToX,
  type KeyDot,
  snapFrame,
  stripLayout,
  timeText,
  xToFrame,
} from '../src/thread/strip/model';
import { polybotApp } from './support';

const clip = (id: string, name: string): ClipRecord => ({ id, name }) as unknown as ClipRecord;
const FPS30 = { num: 30, den: 1 };

describe('the Animations row (§10.6, §4.8)', () => {
  it('shows at most two chips — the active one first in order — and folds the rest into +n', () => {
    const clips = ['a', 'b', 'c', 'd'].map((id) => clip(id, id.toUpperCase()));
    expect(rowChips(clips.slice(0, 2), 'a' as never)).toEqual({ shown: clips.slice(0, 2), folded: 0 });
    const folded = rowChips(clips, 'b' as never);
    expect(folded.shown.map((c) => c.id)).toEqual(['b']);
    expect(folded.folded).toBe(3);
    expect(rowChips(clips, null).shown).toHaveLength(1);
  });

  it('+ New: a clean name, the next free "Animation n", a range of whole frames from 0', () => {
    expect(cleanClipName('  Wave!! 2 ')).toBe('Wave 2');
    expect(nextAnimationName([{ name: 'Animation 2' }, { name: 'clip1' }], (n) => `Animation ${n}`)).toBe(
      'Animation 3',
    );
    expect(framesOf(2, FPS30)).toBe(60);
    expect(framesOf(1, { num: 24000, den: 1001 })).toBe(24);
    expect(newAnimationCall('chr_1' as never, 'Wave', 2, FPS30)).toEqual({
      op: 'clip.new',
      args: { character: 'chr_1', name: 'Wave', range: { start: 0, end: 60 } },
    });
    expect(loopItCall('clp_1' as never)).toEqual({ op: 'clip.loop', args: { clip: 'clp_1' } });
  });
});

describe('controls (§10.1) on Polybot', () => {
  it('a turn ring for FK controls, move for IK goals and the root; Reach on a foot or a hand and the goals', async () => {
    const { app } = await polybotApp();
    const id = (key: string): string =>
      app.store.list('controls').find((control) => control.key === key)?.id ?? `missing ${key}`;
    expect(fittingTool(app, id('fk.upperArm.L') as never)).toBe(VIEWPORT_TOOL.rotate);
    expect(fittingTool(app, id('fk.lowerArm.R') as never)).toBe(VIEWPORT_TOOL.rotate);
    expect(fittingTool(app, id('ik.leg.L') as never)).toBe(VIEWPORT_TOOL.move);
    expect(fittingTool(app, id('root') as never)).toBe(VIEWPORT_TOOL.move);
    expect(reachLimbOf(app, id('fk.foot.L') as never)).toBe('leg.L');
    expect(reachLimbOf(app, id('fk.hand.R') as never)).toBe('arm.R');
    expect(reachLimbOf(app, id('ik.leg.R') as never)).toBe('leg.R');
    expect(reachLimbOf(app, id('fk.upperArm.L') as never)).toBeNull();
    expect(reachLimbOf(app, id('pole.leg.L') as never)).toBeNull();
    app.dispose();
  });

  it('+ swap sides: the copy, then its animation mirrored on every control of the character', async () => {
    const { app, character } = await polybotApp();
    const record = app.store.query.clipsOfCharacter(character)[0] as ClipRecord;
    const calls = swapSidesCalls(app, record);
    expect(calls.map((c) => c.op)).toEqual(['clip.duplicate', 'pose.mirrorAnimation']);
    expect(calls[1]?.args).toMatchObject({ mode: 'flip', offset: 'none' });
    const rig = app.store.query.rigOfCharacter(character);
    if (rig === undefined) throw new Error('no rig');
    const mirror = calls[1];
    if (mirror === undefined) throw new Error('no mirror call');
    expect((mirror.args as { controls: string[] }).controls.length).toBe(app.store.query.controlsOfRig(rig.id).length);
    app.dispose();
  });
});

describe('the Thread’s strip (§10.3)', () => {
  it('maps frames to the ruler and back, snaps to whole frames inside the clip', () => {
    const layout = stripLayout(628, { start: 0, end: 60 });
    expect(frameToX(layout, 0)).toBe(14);
    expect(frameToX(layout, 60)).toBe(614);
    expect(xToFrame(layout, frameToX(layout, 37))).toBeCloseTo(37, 9);
    expect(snapFrame(14.6, { start: 0, end: 60 })).toBe(15);
    expect(snapFrame(-3, { start: 0, end: 60 })).toBe(0);
    expect(snapFrame(99, { start: 0, end: 60 })).toBe(60);
  });

  it('beat ticks every 0.25 s on the whole frame nearest each beat (30 fps: 7.5 frames → 8)', () => {
    const ticks = beatTicks({ start: 0, end: 60 }, FPS30);
    expect(ticks.map((t) => t.frame)).toEqual([0, 8, 15, 23, 30, 38, 45, 53, 60]);
    expect(ticks.filter((t) => t.major).map((t) => t.seconds)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(beatTicks({ start: 0, end: 48 }, { num: 24, den: 1 }).map((t) => t.frame)).toEqual([
      0, 6, 12, 18, 24, 30, 36, 42, 48,
    ]);
  });

  it('the dot under a finger, the keys around the playhead, seconds as the readout shows them', () => {
    const layout = stripLayout(628, { start: 0, end: 60 });
    const dots: KeyDot[] = [10, 30, 45].map((frame) => ({ frame, inBetween: false, selected: false, keys: [] }));
    expect(dotAt(layout, dots, frameToX(layout, 30) + 15, 22)).toBe(1);
    expect(dotAt(layout, dots, frameToX(layout, 20), 22)).toBe(-1);
    expect(between(dots, 20)).toEqual({ before: 10, after: 30 });
    expect(between(dots, 30)).toBeNull();
    expect(between(dots, 50)).toBeNull();
    expect(timeText(15, FPS30)).toBe('0.50 s');
    expect(timeText(15, FPS30, 'frames')).toBe('15 f');
  });
});

describe('the Library (§10.6)', () => {
  const clips = [
    { id: 'walk', label: 'Walk', source: 'Walk_Loop' },
    { id: 'sword-attack', label: 'Sword attack', source: 'Sword_Attack' },
    { id: 'jump-start', label: 'Jump', source: 'Jump_Start' },
    { id: 'dance', label: 'Dance', source: 'Dance_Loop' },
  ];
  it('kinds and search (words or their synonyms)', () => {
    expect(kindOf('walk')).toBe('move');
    expect(kindOf('jump-start')).toBe('move');
    expect(kindOf('spin')).toBe('other');
    expect(matches(clips[1] as never, 'attack')).toBe(true);
    expect(matches(clips[3] as never, 'party')).toBe(true);
    expect(filterLibrary(clips, 'move', '').map((c) => c.id)).toEqual(['walk', 'jump-start']);
    expect(filterLibrary(clips, 'all', 'sword').map((c) => c.id)).toEqual(['sword-attack']);
  });

  it('trim in milliseconds (null for the whole clip), Add is Pro’s Use Clip, the starter set Auto-Rig’s ④', () => {
    expect(trimOf(0, 1, 1)).toBeNull();
    expect(trimOf(0.2, 0.8, 1)).toEqual({ start: 0.2, end: 0.8 });
    expect(trimOf(0.5, 0.51, 1)).toBeUndefined();
    expect(isIdentity(IDENTITY_PARAMS)).toBe(true);
    expect(addCall('chr_1' as never, 'walk', IDENTITY_PARAMS)).toEqual({
      op: 'library.useClip',
      args: { character: 'chr_1', clip: 'walk' },
    });
    const params = { ...IDENTITY_PARAMS, speed: 1.2, inPlace: true };
    expect(addCall('chr_1' as never, 'walk', params)).toEqual({
      op: 'library.useClip',
      args: { character: 'chr_1', clip: 'walk', params },
    });
    expect(starterCalls('chr_1' as never, new Set(['idle', 'walk', 'run', 'dance'])).map((c) => c.op)).toEqual([
      'autorig.clip.add',
      'autorig.clip.add',
      'autorig.clip.add',
    ]);
    expect(starterCalls('chr_1' as never, new Set(['walk'])).map((c) => (c.args as { clip: string }).clip)).toEqual([
      'walk',
    ]);
  });
});

describe('Reach’s plane (§10.1)', () => {
  it('rotates vectors by a quaternion and maps character space to the scene and back', () => {
    const q = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as const; // 90° about Y
    const v = rotate(q, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 9);
    expect(v[2]).toBeCloseTo(-1, 9);
    const placement = { t: [2, 0, 1] as const, q, s: [1, 1, 1] as const };
    const back = toCharacter(placement, toScene(placement, [0.3, 1.2, -0.4]));
    expect(back[0]).toBeCloseTo(0.3, 9);
    expect(back[1]).toBeCloseTo(1.2, 9);
    expect(back[2]).toBeCloseTo(-0.4, 9);
  });

  it('a screen offset lands on the camera-facing plane through the hand', () => {
    // an orthographic front camera, 100 px per metre, y up on screen is −y
    const project = (p: readonly number[]) => ({ x: 500 + (p[0] ?? 0) * 100, y: 400 - (p[1] ?? 0) * 100 });
    const target = planePoint([0, 1, 0], [0, 0, 0, 1], project, 50, -30);
    expect(target?.[0]).toBeCloseTo(0.5, 9);
    expect(target?.[1]).toBeCloseTo(1.3, 9);
    expect(target?.[2]).toBeCloseTo(0, 9);
  });
});

describe('channel chips (§10.1, P14)', () => {
  it('show Pro’s numbers: degrees for turns (stored in radians), metres as they are', () => {
    expect(shownValue('rz', Math.PI / 2)).toBeCloseTo(90, 9);
    expect(storedValue('rz', -5)).toBeCloseTo((-5 * Math.PI) / 180, 12);
    expect(shownValue('tx', 0.25)).toBe(0.25);
    expect(channelChips(() => true)).toEqual(['rx', 'ry', 'rz']);
    expect(channelChips((c) => c.startsWith('t'))).toEqual(['tx', 'ty', 'tz']);
  });
});
