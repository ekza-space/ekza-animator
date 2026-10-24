// STUDIO-TOUCH-SPEC §5.4 (ST-8; T1): tolerances by pointer type. `setPointerTolerance` switches PICK (control, joint
// and manipulator radii, the cycle radius, the marquee threshold) to a finger's or the pen's and back to the mouse's;
// the Quick Rig markers, the extrude cap's handles and the Model select runtime's double-click follow; the mouse keeps
// Studio Pro's values everywhere.
import type { ExtrudeManipFrame } from '@ekza-studio/editor-core';
import { OrthographicCamera } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { handleGrowPx, POINTER_TOLERANCE, pointerInUse, setPointerTolerance } from '../src';
import { pickExtrudeHandle } from '../src/manipulators/extrude/geometry';
import { PaneProjector } from '../src/picking/geometry';
import { PICK } from '../src/theme';
import { DOUBLE_CLICK_MS, DOUBLE_CLICK_PX } from '../src/tools/model/select/runtime';
import { MARKER_PICK_PX, markerPickPx, pickMarker } from '../src/tools/rig/quickRig/rules';

afterEach(() => {
  setPointerTolerance('mouse');
});

const MOUSE = { controlPx: 6, jointPx: 6, manipulatorPx: 7, cycleRadiusPx: 3, marqueeMinPx: 4 };

describe('tolerances by pointer type (§5.4)', () => {
  it('the table: touch 22 / 10 / 450 / 24, pen 9 / 4 / 350 / 8, the mouse Studio Pro’s', () => {
    expect(POINTER_TOLERANCE.touch).toEqual({ pickPx: 22, slopPx: 10, multiTapMs: 450, multiTapPx: 24 });
    expect(POINTER_TOLERANCE.pen).toEqual({ pickPx: 9, slopPx: 4, multiTapMs: 350, multiTapPx: 8 });
    expect(POINTER_TOLERANCE.mouse.multiTapMs).toBe(DOUBLE_CLICK_MS);
    expect(POINTER_TOLERANCE.mouse.multiTapPx).toBe(DOUBLE_CLICK_PX);
    expect(POINTER_TOLERANCE.mouse.pickPx).toBe(MOUSE.controlPx);
  });

  it('PICK follows the pointer and returns to the mouse’s values', () => {
    expect(PICK).toEqual(MOUSE);
    setPointerTolerance('touch');
    expect(pointerInUse()).toBe('touch');
    expect(PICK).toEqual({ controlPx: 22, jointPx: 22, manipulatorPx: 22, cycleRadiusPx: 24, marqueeMinPx: 10 });
    expect(handleGrowPx()).toBe(15);
    setPointerTolerance('pen');
    expect(PICK).toEqual({ controlPx: 9, jointPx: 9, manipulatorPx: 9, cycleRadiusPx: 8, marqueeMinPx: 4 });
    setPointerTolerance('');
    expect(pointerInUse()).toBe('mouse');
    expect(PICK).toEqual(MOUSE);
    expect(handleGrowPx()).toBe(0);
  });

  it('Quick Rig markers: a finger picks a marker 15 px away, the mouse does not (8 px)', () => {
    const hits = [{ name: 'elbow' as const, side: 'R' as const, distPx: 15 }];
    expect(markerPickPx()).toBe(MARKER_PICK_PX);
    expect(pickMarker(hits, null, ['elbow'])).toBeNull();
    setPointerTolerance('touch');
    expect(markerPickPx()).toBe(22);
    expect(pickMarker(hits, null, ['elbow'])?.name).toBe('elbow');
  });

  it('the extrude cap’s handles grow by the pointer’s pick radius, in the same order', () => {
    const camera = new OrthographicCamera(-4, 4, 3, -3, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const projector = new PaneProjector().set(camera, 800, 600, 0.1);
    const axes: [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const frame = { pivot: [0, 0, 0], axes, scaleAxes: axes, space: 'local' } as unknown as ExtrudeManipFrame;
    const s = 1; // 100 px per manipulator unit at 0.01 world units per px
    const centre = projector.width / 2;
    // 20 px from the pivot, off every handle for the mouse (centre 10 px; the X arrow starts at 0.18 × 100 px)
    const x = centre + 14;
    const y = projector.height / 2 + 14;
    expect(pickExtrudeHandle(frame, s, projector, x, y)).toBeNull();
    setPointerTolerance('touch');
    expect(pickExtrudeHandle(frame, s, projector, x, y)).toBe('suniform');
  });
});
