// M6A-SPEC §4.6 ManipHandle `sx/sy/sz/suniform`, §4.7 (B9): the Scale manipulator's handles and picking, and the
// scale maths (axis ratio, uniform travel, pivot-preserving placements, channel edits).
import { quatRotateVec3, type ReadonlyXf } from '@ekza-animator/anim-core';
import type { ControlId } from '@ekza-animator/doc';
import { OrthographicCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { dragControl } from '../src/manipulators/drag';
import { ManipulatorKit, type ManipTarget } from '../src/manipulators/ManipulatorKit';
import {
  MIN_UNIFORM_SCALE,
  objectScaleDrag,
  scaleEdits,
  scaleFactors,
  scalePlacement,
} from '../src/manipulators/scale/math';
import { PaneProjector } from '../src/picking/geometry';

const W = 400;
const H = 400;

/** A front orthographic view 4 m high looking down −Z at the origin; 1 m = 100 px. */
function frontView(): { camera: OrthographicCamera; projector: PaneProjector } {
  const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return { camera, projector: new PaneProjector().set(camera, W, H, camera.near) };
}

const AXES = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
] as const;

function target(s?: readonly [boolean, boolean, boolean]): ManipTarget {
  const all = [true, true, true] as const;
  return {
    pivot: [0, 0, 0],
    worldQ: [0, 0, 0, 1],
    parentQ: [0, 0, 0, 1],
    r: [0, 0, 0],
    order: 'xyz',
    keyable: { t: all, r: all, ...(s === undefined ? {} : { s }) },
  };
}

describe('the scale manipulator', () => {
  it('shows the three axes and the uniform cube in object space, filtered by keyable scale channels', () => {
    const kit = new ManipulatorKit();
    kit.configure('scale', 'world', 100);
    expect(kit.currentSpace).toBe('object');
    kit.setTarget(target());
    expect(kit.handles()).toEqual(['sx', 'sy', 'sz', 'suniform']);
    kit.setTarget(target([false, true, false]));
    expect(kit.handles()).toEqual(['sy', 'suniform']);
    kit.setTarget(target([false, false, false]));
    expect(kit.handles()).toEqual([]);
    expect(kit.lockedHandles()).toEqual([]);
    kit.dispose();
  });

  it('picks the uniform cube at the pivot and an axis along its line; grab points sit on them', () => {
    const kit = new ManipulatorKit();
    kit.configure('scale', 'object', 100);
    kit.setTarget(target());
    const { camera, projector } = frontView();
    // 100 px manipulator: the X axis runs from the centre to the right, Y up.
    expect(kit.pick(camera, projector, H, 200, 200)).toBe('suniform');
    expect(kit.pick(camera, projector, H, 270, 200)).toBe('sx');
    expect(kit.pick(camera, projector, H, 200, 130)).toBe('sy');
    expect(kit.pick(camera, projector, H, 330, 330)).toBeNull();
    const grab = kit.grabPoint('sx', camera, projector, H);
    expect(grab?.x).toBeCloseTo(270, 6);
    expect(grab?.y).toBeCloseTo(200, 6);
    expect(kit.grabPoint('suniform', camera, projector, H)).toMatchObject({ x: 200, y: 200 });
    kit.dispose();
  });
});

describe('scale maths', () => {
  const view = frontView();
  const base = { pivot: [0, 0, 0] as const, axes: AXES, view, sizePx: 100 };

  it('axis handles scale by the ratio of the positions along the axis (crossing the pivot mirrors)', () => {
    const at = scaleFactors({ ...base, handle: 'sx', start: { x: 250, y: 200 } });
    expect(at(300, 260)).toEqual([2, 1, 1]); // only the travel along X counts
    expect(at(225, 200)).toEqual([0.5, 1, 1]);
    expect(at(150, 200)).toEqual([-1, 1, 1]);
    const onPivot = scaleFactors({ ...base, handle: 'sy', start: { x: 200, y: 200 } });
    expect(onPivot(200, 100)).toBeNull();
  });

  it('the uniform handle grows right and up by one per manipulator size, never below the minimum', () => {
    const at = scaleFactors({ ...base, handle: 'suniform', start: { x: 200, y: 200 } });
    expect(at(250, 200)).toEqual([1.5, 1.5, 1.5]);
    expect(at(200, 150)).toEqual([1.5, 1.5, 1.5]);
    expect(at(-500, 200)).toEqual([MIN_UNIFORM_SCALE, MIN_UNIFORM_SCALE, MIN_UNIFORM_SCALE]);
  });

  it('keeps the pivot in place: t′ = t + R((S − S′)·p)', () => {
    const q: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2]; // 90° about Z
    const object = {
      id: 'msh_A',
      placement: { t: [1, 2, 3] as const, q, s: [1, 2, 1] as const },
      pivot: [0, 1, 0] as const,
    };
    const scaled = scalePlacement(object, [1, 3, 1]);
    expect(scaled.s).toEqual([1, 6, 1]);
    // Local (0, (2 − 6)·1, 0) = (0, −4, 0), turned 90° about Z = (4, 0, 0).
    expect(scaled.t[0]).toBeCloseTo(5, 12);
    expect(scaled.t[1]).toBeCloseTo(2, 12);
    expect(scaled.t[2]).toBeCloseTo(3, 12);
    // The pivot's parent-space position t + R(S·p) is the same before and after.
    const pivotOf = (xf: ReadonlyXf): number[] => {
      const r = quatRotateVec3(xf.q, [0, xf.s[1], 0]); // the pivot is (0, 1, 0)
      return [xf.t[0] + r[0], xf.t[1] + r[1], xf.t[2] + r[2]];
    };
    const before = pivotOf(object.placement);
    pivotOf(scaled).forEach((value, i) => expect(value).toBeCloseTo(before[i] as number, 12));
  });

  it('object drags return one placement per object; control drags edit only keyable scale channels', () => {
    const drag = objectScaleDrag({
      ...base,
      handle: 'suniform',
      start: { x: 200, y: 200 },
      objects: [
        { id: 'msh_A', placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] }, pivot: [0, 0, 0] },
        { id: 'grp_B', placement: { t: [1, 0, 0], q: [0, 0, 0, 1], s: [2, 2, 2] }, pivot: [0, 0, 0] },
      ],
    });
    expect(drag.ids).toEqual(['msh_A', 'grp_B']);
    expect(drag.update(300, 200)?.map((xf) => xf.s)).toEqual([
      [2, 2, 2],
      [4, 4, 4],
    ]);
    expect(drag.amount).toBe(2);

    const control = dragControl({
      control: 'ctl_A' as ControlId,
      order: 'xyz',
      world: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      t: [0, 0, 0],
      r: [0, 0, 0],
      s: [1, 2, 3],
      keyable: { t: [true, true, true], r: [true, true, true], s: [true, false, true] },
    });
    expect(scaleEdits([control], [2, 2, 2])).toEqual([
      { control: 'ctl_A', channel: 'sx', value: 2 },
      { control: 'ctl_A', channel: 'sz', value: 6 },
    ]);
    const noScale = dragControl({
      control: 'ctl_B' as ControlId,
      order: 'xyz',
      world: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      t: [0, 0, 0],
      r: [0, 0, 0],
      s: [1, 1, 1],
      keyable: { t: [true, true, true], r: [true, true, true] },
    });
    expect(scaleEdits([noScale], [2, 2, 2])).toEqual([]);
  });
});
