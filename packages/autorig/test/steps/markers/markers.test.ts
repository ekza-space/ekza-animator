// AUTORIG-SPEC §5.3, §8.1, §8.3 (D4): ② Markers' pure parts — the `markers` slice reducers (the pane under the pointer,
// the last ortho pane), the pane grid per device class (front │ side │ persp 40/30/30; front │ side or 3D on a tablet;
// one pane on a phone), the keyboard nudge (front: x and y, side: z and y, the hidden axis copied bit for bit, screen
// directions from the pane's camera), the pose class of the guess (§4.3: 'a' above 5°) and the key rows.
import { describe, expect, it } from 'vitest';
import { AUTORIG_KEYMAP } from '../../../src';
import { markersKeys, NUDGE_ACTION } from '../../../src/keymap/steps/markers';
import { bindingFor } from '../../../src/shell/keys';
import { poseClass } from '../../../src/steps/markers/enter';
import {
  MARKER_PANE_IDS,
  MARKERS_SLICE,
  markerPanes,
  nudgePane,
  paneKind,
  screenClass,
  withPane,
} from '../../../src/steps/markers/index';
import { nudged } from '../../../src/steps/markers/keys';

const DEG = Math.PI / 180;
const key = (code: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({ code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: null, ...mods }) as KeyboardEvent;

describe('the markers slice (§5.3, §8.1)', () => {
  it('starts on FRONT and remembers the last ortho pane under the pointer', () => {
    expect(MARKERS_SLICE).toEqual({ pane: 'front', lastOrtho: 'front' });
    expect(withPane(MARKERS_SLICE, 'front')).toEqual({});
    const side = { ...MARKERS_SLICE, ...withPane(MARKERS_SLICE, 'side') };
    expect(side).toEqual({ pane: 'side', lastOrtho: 'side' });
    const persp = { ...side, ...withPane(side, 'persp') };
    expect(persp).toEqual({ pane: 'persp', lastOrtho: 'side' });
    expect(withPane(persp, 'persp')).toEqual({});
    // the nudge acts in the pane under the pointer, or the last ortho pane over persp
    expect(nudgePane(side)).toBe('side');
    expect(nudgePane(persp)).toBe('side');
    expect(nudgePane(MARKERS_SLICE)).toBe('front');
  });

  it('maps pane ids to kinds', () => {
    expect(paneKind('pane-front')).toBe('front');
    expect(paneKind('pane-side')).toBe('side');
    expect(paneKind('pane-persp')).toBe('persp');
    expect(paneKind('pane-left')).toBeNull();
    expect(paneKind(null)).toBeNull();
  });
});

describe('the ② pane grid (§5.3, §8.3)', () => {
  it('classes the window: phone < 700 px, tablet < 1024 px, desktop', () => {
    expect([390, 699, 700, 1023, 1024, 1440].map(screenClass)).toEqual([
      'phone',
      'phone',
      'tablet',
      'tablet',
      'desktop',
      'desktop',
    ]);
  });

  it('desktop: front │ side │ persp at 40/30/30 (the R-Markers ids)', () => {
    expect(markerPanes(MARKERS_SLICE, 'desktop')).toEqual([
      { id: MARKER_PANE_IDS.front, size: 40 },
      { id: MARKER_PANE_IDS.side, size: 30 },
      { id: MARKER_PANE_IDS.persp, size: 30 },
    ]);
  });

  it('tablet: front │ side, or the 3D pane; phone: the one chosen pane', () => {
    expect(markerPanes(MARKERS_SLICE, 'tablet')).toEqual([
      { id: 'pane-front', size: 50 },
      { id: 'pane-side', size: 50 },
    ]);
    expect(markerPanes({ pane: 'persp', lastOrtho: 'side' }, 'tablet')).toEqual([{ id: 'pane-persp' }]);
    expect(markerPanes({ pane: 'side', lastOrtho: 'side' }, 'phone')).toEqual([{ id: 'pane-side' }]);
    expect(markerPanes(MARKERS_SLICE, 'phone')).toEqual([{ id: 'pane-front' }]);
  });
});

describe('the keyboard nudge (§8.1, WCAG 2.5.7)', () => {
  const point = [-0.4599297004006803, 1.3314453498460352, -0.015000000223517418] as const;
  // a front camera looking down −Z (right = +X, up = +Y); a side camera looking down −X (right = −Z)
  const front = { right: [1, 0, 0], up: [0, 1, 0] } as const;
  const side = { right: [0, 0, -1], up: [0, 1, 0] } as const;

  it('front moves x and y, the hidden z bit-equal', () => {
    const right = nudged(point, 'front', { dx: 1, dy: 0, step: 0.01 }, front);
    expect(right).toEqual([point[0] + 0.01, point[1], point[2]]);
    const down = nudged(point, 'front', { dx: 0, dy: -1, step: 0.001 }, front);
    expect(down[0]).toBe(point[0]);
    expect(down[1]).toBe(point[1] - 0.001);
    expect(down[2]).toBe(point[2]);
  });

  it('side moves z (along the camera screen right) and y, the hidden x bit-equal', () => {
    const right = nudged(point, 'side', { dx: 1, dy: 0, step: 0.01 }, side);
    expect(right).toEqual([point[0], point[1], point[2] - 0.01]);
    const up = nudged(point, 'side', { dx: 0, dy: 1, step: 0.01 }, side);
    expect(up).toEqual([point[0], point[1] + 0.01, point[2]]);
    // without a camera (the pane is not shown): +X / +Z right, +Y up
    expect(nudged(point, 'side', { dx: 1, dy: 0, step: 0.01 }, null)[2]).toBe(point[2] + 0.01);
  });

  it('binds the arrows (1 cm, Shift 1 mm) and G only in ②', () => {
    const rows = markersKeys.map((row) => ('op' in row.run ? row.run.op : `${row.run.action}`));
    expect(rows.filter((row) => row === NUDGE_ACTION)).toHaveLength(8);
    expect(rows).toContain('skel.quickRig.guess');
    expect(markersKeys.every((row) => row.steps !== 'all' && row.steps.includes('markers'))).toBe(true);
    expect(bindingFor(key('ArrowDown', { shiftKey: true }), 'markers', false)?.run).toEqual({
      action: NUDGE_ACTION,
      args: { dx: 0, dy: -1, step: 0.001 },
    });
    expect(bindingFor(key('ArrowLeft'), 'markers', false)?.run).toEqual({
      action: NUDGE_ACTION,
      args: { dx: -1, dy: 0, step: 0.01 },
    });
    expect(bindingFor(key('ArrowLeft'), 'rig', false)).toBeNull();
    expect(bindingFor(key('KeyG'), 'model', false)).toBeNull();
    expect(AUTORIG_KEYMAP).toEqual(expect.arrayContaining([...markersKeys]));
  });
});

describe('the pose class of the guess (§4.3)', () => {
  it("is 't' up to 5° and 'a' above", () => {
    expect(poseClass(0)).toEqual({ armAngle: 0, kind: 't' });
    expect(poseClass(5 * DEG).kind).toBe('t');
    expect(poseClass(5.01 * DEG).kind).toBe('a');
    expect(poseClass(44 * DEG).kind).toBe('a');
  });
});
