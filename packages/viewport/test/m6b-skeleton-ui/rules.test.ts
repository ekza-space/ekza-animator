// M6B-SPEC §0.4.2 gates (C3): the axis rule — a front drag of 1,000 random markers leaves z bit-equal, a side drag
// leaves x bit-equal, a top drag y; centre markers stay on x = 0 — and the pick rule: the selected marker wins among
// overlapping markers, otherwise the nearest (ties in list order), a ghost picks but never drags, repeated clicks
// cycle through the set. The §5.7 state table, row by row.
import { QUICK_RIG_MARKERS } from '@ekza-studio/editor-core';
import type { QuickRigMarker } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import {
  axisRuleDrag,
  cycleMarker,
  ghostOf,
  hiddenAxisOf,
  isRepeatClick,
  MARKER_PICK_PX,
  type MarkerHit,
  pickMarker,
  type Vec3,
} from '../../src/tools/rig/quickRig/rules';
import {
  JOINT_POSED_REFUSAL,
  JOINT_SCALE_REFUSAL,
  jointAction,
  jointGestureOf,
  jointSkeletonState,
} from '../../src/tools/rig/jointTransform/stateTable';

/** A deterministic PRNG (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const vec = (next: () => number, span = 2): Vec3 => [(next() - 0.5) * span, next() * span, (next() - 0.5) * span];

describe('axis rule (§0.4.2)', () => {
  it('the hidden axis of each view', () => {
    expect([hiddenAxisOf('front'), hiddenAxisOf('side'), hiddenAxisOf('top'), hiddenAxisOf('persp')]).toEqual([
      2,
      0,
      1,
      null,
    ]);
    expect(hiddenAxisOf(null)).toBeNull();
  });

  for (const [view, hidden] of [
    ['front', 2],
    ['side', 0],
    ['top', 1],
  ] as const) {
    it(`a ${view} drag of 1,000 random markers keeps the hidden axis bit-equal and moves the others`, () => {
      const next = random(hidden + 7);
      for (let i = 0; i < 1000; i++) {
        const marker = vec(next);
        const start = vec(next);
        const hit = vec(next);
        const scale = next() < 0.2 ? 0.1 : 1;
        const moved = axisRuleDrag(marker, start, hit, hidden, { scale });
        expect(Object.is(moved[hidden], marker[hidden])).toBe(true);
        const expected = [0, 1, 2].map((k) =>
          k === hidden ? marker[k] : (marker[k] as number) + ((hit[k] as number) - (start[k] as number)) * scale,
        );
        expect([...moved]).toEqual(expected);
      }
    });
  }

  it('visible axes take the travel, scaled by Shift and snapped with X; centre markers stay on x = 0', () => {
    const marker: Vec3 = [-0.4, 1.3, 0.02];
    expect(axisRuleDrag(marker, [0, 0, 5], [0.1, -0.2, 9], 2)).toEqual([-0.30000000000000004, 1.1, 0.02]);
    expect(axisRuleDrag(marker, [0, 0, 0], [0.1, -0.2, 0], 2, { scale: 0.1 })).toEqual([-0.39, 1.28, 0.02]);
    expect(axisRuleDrag(marker, [0, 0, 0], [0.13, 0, 0], 2, { snap: 0.1 })).toEqual([-0.30000000000000004, 1.3, 0.02]);
    // Side view: z and y move, x bit-equal.
    expect(axisRuleDrag(marker, [3, 0, 0], [7, 0.1, -0.05], 0)).toEqual([
      -0.4, 1.4000000000000001, -0.030000000000000002,
    ]);
    // A centre marker: x is +0 in the front view whatever the pointer does.
    const chin: Vec3 = [0, 1.48, 0.01];
    const front = axisRuleDrag(chin, [0, 0, 0], [0.2, 0.03, 0], 2, { centre: true });
    expect(Object.is(front[0], 0)).toBe(true);
    expect(front[1]).toBeCloseTo(1.51, 12);
    const side = axisRuleDrag(chin, [0, 0, 0], [0.2, 0.03, 0.05], 0, { centre: true });
    expect(Object.is(side[0], 0)).toBe(true);
    expect(side[2]).toBeCloseTo(0.06, 12);
    // 1,000 random centre markers dragged in the front view stay on x = 0.
    const next = random(99);
    for (let i = 0; i < 1000; i++) {
      const m: Vec3 = [0, next() * 2, next() - 0.5];
      expect(Object.is(axisRuleDrag(m, vec(next), vec(next), 2, { centre: true })[0], 0)).toBe(true);
    }
  });

  it('the left ghost mirrors x', () => {
    expect(ghostOf([-0.48, 1.31, -0.02])).toEqual([0.48, 1.31, -0.02]);
    expect(Object.is(ghostOf([0, 1, 0])[0], 0)).toBe(true);
  });
});

describe('pick rule (§0.4.2)', () => {
  const order = QUICK_RIG_MARKERS;
  // The T-pose side view: shoulder, elbow and wrist on one spot.
  const stacked: MarkerHit[] = [
    { name: 'shoulder', side: 'R', distPx: 1.5 },
    { name: 'elbow', side: 'R', distPx: 2.5 },
    { name: 'wrist', side: 'R', distPx: 0.5 },
    { name: 'shoulder', side: 'L', distPx: 1.5 },
    { name: 'elbow', side: 'L', distPx: 2.5 },
    { name: 'wrist', side: 'L', distPx: 0.5 },
    { name: 'knee', side: 'R', distPx: 40 },
  ];

  it('the selected marker wins among overlapping ones', () => {
    expect(pickMarker(stacked, 'elbow', order)).toEqual({
      name: 'elbow',
      ghost: false,
      set: ['shoulder', 'elbow', 'wrist'],
    });
  });

  it('otherwise the nearest wins; ties in list order; nothing beyond the radius', () => {
    expect(pickMarker(stacked, null, order)?.name).toBe('wrist');
    expect(pickMarker(stacked, 'knee', order)?.name).toBe('wrist');
    const tie: MarkerHit[] = [
      { name: 'ankle', side: 'R', distPx: 3 },
      { name: 'knee', side: 'R', distPx: 3 },
    ];
    expect(pickMarker(tie, null, order)?.name).toBe('knee');
    expect(pickMarker([{ name: 'toe', side: 'R', distPx: MARKER_PICK_PX + 0.01 }], null, order)).toBeNull();
    expect(pickMarker([], 'toe', order)).toBeNull();
  });

  it('a ghost alone picks its marker but never drags', () => {
    const pick = pickMarker([{ name: 'knee', side: 'L', distPx: 1 }], null, order);
    expect(pick).toEqual({ name: 'knee', ghost: true, set: ['knee'] });
  });

  it('repeated clicks on the same spot cycle through the set in list order', () => {
    const set: QuickRigMarker[] = ['shoulder', 'elbow', 'wrist'];
    expect(cycleMarker(set, 'elbow')).toBe('wrist');
    expect(cycleMarker(set, 'wrist')).toBe('shoulder');
    expect(cycleMarker(set, null)).toBe('shoulder');
    expect(cycleMarker(set, 'knee')).toBe('shoulder');
    expect(cycleMarker([], 'knee')).toBeNull();
    expect(isRepeatClick({ paneId: 'pane-side', x: 10, y: 10 }, 'pane-side', 11, 11)).toBe(true);
    expect(isRepeatClick({ paneId: 'pane-side', x: 10, y: 10 }, 'pane-side', 13, 10)).toBe(false);
    expect(isRepeatClick({ paneId: 'pane-side', x: 10, y: 10 }, 'pane-front', 10, 10)).toBe(false);
    expect(isRepeatClick(null, 'pane-side', 10, 10)).toBe(false);
  });
});

describe('§5.7 state table', () => {
  it('every gesture in every state', () => {
    const table = (['W', 'D+W', 'E', 'D+E', 'R'] as const).map((gesture) => [
      gesture,
      ...(['unbound', 'bound', 'posed'] as const).map((state) => {
        const action = jointAction(gesture, state);
        return action.kind === 'refused'
          ? `refused: ${action.reason}`
          : action.kind === 'test-pose'
            ? 'test-pose'
            : `${action.kind} ${action.mode}`;
      }),
    ]);
    expect(table).toEqual([
      ['W', 'rest-move subtree', 'rest-move subtree', `refused: ${JOINT_POSED_REFUSAL}`],
      ['D+W', 'rest-move joint', 'rest-move joint', `refused: ${JOINT_POSED_REFUSAL}`],
      ['E', 'rest-rotate subtree', 'test-pose', 'test-pose'],
      ['D+E', 'rest-rotate joint', 'rest-rotate joint', `refused: ${JOINT_POSED_REFUSAL}`],
      ['R', `refused: ${JOINT_SCALE_REFUSAL}`, `refused: ${JOINT_SCALE_REFUSAL}`, `refused: ${JOINT_SCALE_REFUSAL}`],
    ]);
  });

  it('the state of a skeleton and the gesture of a tool', () => {
    expect(jointSkeletonState(false, 'test')).toBe('unbound');
    expect(jointSkeletonState(true, 'bind')).toBe('bound');
    expect(jointSkeletonState(true, 'test')).toBe('posed');
    expect(jointSkeletonState(true, 'clip')).toBe('posed');
    expect(jointGestureOf('move', false)).toBe('W');
    expect(jointGestureOf('move', true)).toBe('D+W');
    expect(jointGestureOf('rotate', false)).toBe('E');
    expect(jointGestureOf('rotate', true)).toBe('D+E');
    expect(jointGestureOf('scale', false)).toBe('R');
    expect(jointGestureOf('select', true)).toBeNull();
  });
});
