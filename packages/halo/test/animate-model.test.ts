// The Animate stage's pure parts (STUDIO-TOUCH-SPEC §10; T7): the Animations row's chips folded to the visible-target
// budget, + New's arguments (whole frames of 1, 2 or 4 s), the fitting manipulator (a turn ring for FK controls, move
// for IK goals and the root) and the controls that Reach, on Polybot; the Thread's strip geometry, the ruler (a tick on
// every frame, ST-T10-RULER), the dot under a finger and the Blend chip's keys; the Library's kinds, search, trim and calls; Reach's plane
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
  newLengths,
  nextAnimationName,
  reachLimbOf,
  rowChips,
  swapSidesCalls,
} from '../src/stages/animate/model';
import { planePoint, rotate, toCharacter, toScene } from '../src/stages/animate/reach';
import {
  between,
  dotAt,
  frameToX,
  type KeyDot,
  MIN_TICK_PX,
  type RulerLabel,
  rulerMarks,
  secondsLabel,
  snapFrame,
  stripLayout,
  timeText,
  xToFrame,
} from '../src/thread/strip/model';
import { polybotApp } from './support';

const clip = (id: string, name: string): ClipRecord => ({ id, name }) as unknown as ClipRecord;
const FPS30 = { num: 30, den: 1 };

describe('the Animations row (§10.6, §4.8)', () => {
  it('shows up to three chips — the active one among them, in order — and folds the rest into +n', () => {
    const clips = ['a', 'b', 'c', 'd', 'e'].map((id) => clip(id, id.toUpperCase()));
    expect(rowChips(clips.slice(0, 3), 'a' as never)).toEqual({ shown: clips.slice(0, 3), folded: 0 });
    // past three: the active one, the most recent other and +n — never more than three animation targets
    const folded = rowChips(clips, 'b' as never);
    expect(folded.shown.map((c) => c.id)).toEqual(['b', 'e']);
    expect(folded.folded).toBe(3);
    expect(rowChips(clips.slice(0, 4), 'd' as never)).toEqual({ shown: [clips[2], clips[3]], folded: 2 });
    // no active one: the most recent
    expect(rowChips(clips, null).shown.map((c) => c.id)).toEqual(['d', 'e']);
    // a phone shows the active one only
    expect(rowChips(clips, 'a' as never, 1).shown.map((c) => c.id)).toEqual(['a']);
  });

  it('+ New: a clean name, the next free "Animation n", a range of whole frames from 0', () => {
    expect(cleanClipName('  Wave!! 2 ')).toBe('Wave 2');
    expect(nextAnimationName([{ name: 'Animation 2' }, { name: 'clip1' }], (n) => `Animation ${n}`)).toBe(
      'Animation 3',
    );
    expect(framesOf(2, FPS30)).toBe(60);
    expect(framesOf(1, { num: 24000, den: 1001 })).toBe(24);
    expect(newAnimationCall('chr_1' as never, 'Wave', 60)).toEqual({
      op: 'clip.new',
      args: { character: 'chr_1', name: 'Wave', range: { start: 0, end: 60 } },
    });
    // ST-T7-UNIT: 30 · 60 · 100 frames by default; 1 · 2 · 4 s with Settings › Time on Seconds
    expect(newLengths('frames', FPS30).map((l) => [l.shown, l.frames, l.primary])).toEqual([
      [30, 30, false],
      [60, 60, true],
      [100, 100, false],
    ]);
    expect(newLengths('seconds', { num: 24, den: 1 }).map((l) => l.frames)).toEqual([24, 48, 96]);
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

  // a mono font of 11 px: 6.6 px a character
  const measure = (text: string): number => text.length * 6.6;
  const apart = (labels: readonly RulerLabel[]): boolean =>
    labels.every(
      (label, i) => i === 0 || (labels[i - 1] as RulerLabel).left + (labels[i - 1] as RulerLabel).width <= label.left,
    );

  it('a tick on every frame and a number every 5th frame for a 60 f animation on an iPad (ST-T10-RULER)', () => {
    const layout = stripLayout(628, { start: 0, end: 60 });
    const marks = rulerMarks(layout, 628, { start: 0, end: 60 }, FPS30, 'frames', measure);
    expect(marks.tickStep).toBe(1);
    expect(marks.ticks).toHaveLength(61);
    expect(marks.labelStep).toBe(5);
    expect(marks.ticks.filter((t) => t.level === 2).map((t) => t.frame)).toEqual([
      0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
    ]);
    expect(marks.labels.map((l) => l.text)).toEqual([
      '0',
      '5',
      '10',
      '15',
      '20',
      '25',
      '30',
      '35',
      '40',
      '45',
      '50',
      '55',
      '60',
    ]);
    // the last number sits left of its tick (it would leave the strip), right of it otherwise (Studio Pro's way)
    const last = marks.labels.at(-1) as RulerLabel;
    expect(last.left + last.width).toBeLessThanOrEqual(frameToX(layout, 60));
    expect((marks.labels[1] as RulerLabel).left).toBeGreaterThan(frameToX(layout, 5));
    expect(apart(marks.labels)).toBe(true);
  });

  it('100 f: ticks every frame, numbers every 10th with halves taller; the first and last always numbered', () => {
    const layout = stripLayout(628, { start: 0, end: 100 });
    const marks = rulerMarks(layout, 628, { start: 0, end: 100 }, FPS30, 'frames', measure);
    expect(marks.tickStep).toBe(1);
    expect(marks.ticks).toHaveLength(101);
    expect(marks.labelStep).toBe(10);
    // the halves between two numbers are taller than a frame's tick
    expect(marks.ticks.filter((t) => t.level === 1).map((t) => t.frame)).toEqual([
      5, 15, 25, 35, 45, 55, 65, 75, 85, 95,
    ]);
    expect(marks.labels[0]?.text).toBe('0');
    expect(marks.labels.at(-1)?.text).toBe('100');
    expect(apart(marks.labels)).toBe(true);
    // an odd end still gets its number, and the major next to it gives way
    const odd = rulerMarks(
      stripLayout(628, { start: 0, end: 97 }),
      628,
      { start: 0, end: 97 },
      FPS30,
      'frames',
      measure,
    );
    expect(odd.labels.at(-1)?.text).toBe('97');
    expect(apart(odd.labels)).toBe(true);
  });

  it('zoomed in, every frame is numbered; zoomed far out, ticks fall back to every 2nd, then 5th frame', () => {
    const close = rulerMarks(
      stripLayout(628, { start: 20, end: 32 }),
      628,
      { start: 0, end: 60 },
      FPS30,
      'frames',
      measure,
    );
    expect(close.labelStep).toBe(1);
    expect(close.labels.map((l) => l.frame)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
    const far = rulerMarks(
      stripLayout(390, { start: 0, end: 200 }),
      390,
      { start: 0, end: 200 },
      FPS30,
      'frames',
      measure,
    );
    // 1.8 px a frame: every 2nd frame
    expect(far.tickStep).toBe(2);
    const farther = rulerMarks(
      stripLayout(390, { start: 0, end: 500 }),
      390,
      { start: 0, end: 500 },
      FPS30,
      'frames',
      measure,
    );
    expect(farther.tickStep).toBe(5);
    for (const marks of [far, farther]) {
      const perFrame = (390 - 28) / (marks === far ? 200 : 500);
      expect(marks.tickStep * perFrame).toBeGreaterThanOrEqual(MIN_TICK_PX);
      expect(marks.labelStep % marks.tickStep).toBe(0);
      expect(apart(marks.labels)).toBe(true);
    }
  });

  it('under Seconds the ticks stay on frames and the numbers read seconds', () => {
    const layout = stripLayout(628, { start: 0, end: 60 });
    const marks = rulerMarks(layout, 628, { start: 0, end: 60 }, FPS30, 'seconds', measure);
    expect(marks.tickStep).toBe(1);
    expect(marks.ticks).toHaveLength(61);
    expect(marks.labels[0]?.text).toBe('0');
    expect(marks.labels.at(-1)?.text).toBe('2 s');
    // labels fall on whole frames: 0.25 s at 30 fps is 7.5 frames, so it is never a step
    expect(marks.labels.every((l) => Number.isInteger(l.frame))).toBe(true);
    expect(secondsLabel(15, FPS30)).toBe('0.5');
    expect(secondsLabel(45, FPS30)).toBe('1.5');
    expect(apart(marks.labels)).toBe(true);
  });

  it('the dot under a finger, the keys around the playhead, seconds as the readout shows them', () => {
    const layout = stripLayout(628, { start: 0, end: 60 });
    const dots: KeyDot[] = [10, 30, 45].map((frame) => ({ frame, inBetween: false, selected: false, keys: [] }));
    expect(dotAt(layout, dots, frameToX(layout, 30) + 15, 22)).toBe(1);
    expect(dotAt(layout, dots, frameToX(layout, 20), 22)).toBe(-1);
    expect(between(dots, 20)).toEqual({ before: 10, after: 30 });
    expect(between(dots, 30)).toBeNull();
    expect(between(dots, 50)).toBeNull();
    expect(timeText(15, FPS30, 'seconds')).toBe('0.50 s');
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
