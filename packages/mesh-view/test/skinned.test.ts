// SkinnedSurface (M6B-SPEC §4.7, §5.1; C1) on a real WebGL canvas: a pixel probe of a posed elbow (an arm box bound
// to an upper and a lower bone; rotating the lower bone 90° moves the forearm's pixels up), CPU skinning for picking,
// partial weight uploads and the uniform-only weight-display switch.
import { primitive, type SkinWeights } from '@ekza-studio/mesh-core';
import { Matrix4 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { SkinnedSurface } from '../src';
import { BACKGROUND, type Canvas, canvas, DISPLAY, derived, LAYERS, orthoFront, screen, THEME } from './support';

let c: Canvas | null = null;
const views: SkinnedSurface[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.dispose();
  c?.dispose();
  c = null;
});

const bg = [(BACKGROUND >> 16) & 255, (BACKGROUND >> 8) & 255, BACKGROUND & 255];
const isBackground = (rgba: readonly number[]): boolean =>
  rgba.slice(0, 3).every((v, i) => Math.abs(v - (bg[i] as number)) <= 2);

/** An arm box along X (x ∈ [−0.5, 0.5]): points with x ≤ 0 on the upper bone (0), the others on the lower bone (1). */
function arm() {
  const d = derived(primitive('cube', { width: 1, height: 0.2, depth: 0.2, subdivisionsWidth: 4 }));
  const P = d.data.counts.points;
  const joints = new Uint16Array(4 * P);
  const weights = new Float32Array(4 * P);
  for (let p = 0; p < P; p++) {
    joints[4 * p] = (d.data.position[3 * p] as number) > 1e-6 ? 1 : 0;
    weights[4 * p] = 1;
  }
  const skin: SkinWeights = {
    points: P,
    palette: [
      { key: 'jnt_upper', parent: null, mirror: null },
      { key: 'jnt_lower', parent: 'jnt_upper', mirror: null },
    ],
    joints,
    weights,
  };
  return { d, skin };
}

const upperRest = new Matrix4().makeTranslation(-0.5, 0, 0);
const lowerRest = new Matrix4().makeTranslation(0, 0, 0);
const inverseBind = Float64Array.from([...upperRest.clone().invert().elements, ...lowerRest.clone().invert().elements]);
const bones = (lower: Matrix4) => Float64Array.from([...upperRest.elements, ...lower.elements]);

describe('SkinnedSurface', () => {
  it('draws the posed elbow: rotating the lower bone 90° moves the forearm up (pixel probe)', () => {
    const { d, skin } = arm();
    const view = new SkinnedSurface({ theme: THEME, layers: LAYERS });
    views.push(view);
    view.setData(d.data, d.tri, d.normals, skin, null, Int32Array.of(0, 1));
    c = canvas();
    c.scene.add(view.root);
    const camera = orthoFront(3);
    const forearm = screen(camera, [0.35, 0, 0], 400, 300);
    const raised = screen(camera, [0, 0.35, 0], 400, 300);
    view.applyPane(DISPLAY);
    c.render(camera);
    expect(isBackground(c.pixel(...forearm))).toBe(false);
    expect(isBackground(c.pixel(...raised))).toBe(true);

    view.setBones(bones(new Matrix4().makeRotationZ(Math.PI / 2)), inverseBind);
    view.applyPane(DISPLAY);
    c.render(camera);
    expect(isBackground(c.pixel(...forearm))).toBe(true);
    expect(isBackground(c.pixel(...raised))).toBe(false);
    // The upper arm did not move.
    expect(isBackground(c.pixel(...screen(camera, [-0.3, 0, 0], 400, 300)))).toBe(false);
  });

  it('cpuSkin gives the posed points; the bind pose before any bones', () => {
    const { d, skin } = arm();
    const view = new SkinnedSurface({ theme: THEME, layers: LAYERS });
    views.push(view);
    view.setData(d.data, d.tri, d.normals, skin, null, Int32Array.of(0, 1));
    const out = new Float32Array(3 * d.data.counts.points);
    view.cpuSkin(out);
    expect(Array.from(out)).toEqual(Array.from(d.data.position));
    view.setBones(bones(new Matrix4().makeRotationZ(Math.PI / 2)), inverseBind);
    view.cpuSkin(out);
    // Forearm points rotate 90° about Z around the elbow, (x, y) → (−y, x); upper-arm points stay.
    const far = Array.from({ length: d.data.counts.points }, (_, p) => {
      const x = d.data.position[3 * p] as number;
      const y = d.data.position[3 * p + 1] as number;
      const [ex, ey] = x > 1e-6 ? [-y, x] : [x, y];
      return Math.max(Math.abs((out[3 * p] as number) - ex), Math.abs((out[3 * p + 1] as number) - ey));
    });
    expect(Math.max(...far)).toBeLessThan(1e-5);
  });

  it('uploads only the corners of the changed points on a weight edit and nothing on an active-influence switch', () => {
    const { d, skin } = arm();
    const view = new SkinnedSurface({ theme: THEME, layers: LAYERS });
    views.push(view);
    view.setData(d.data, d.tri, d.normals, skin, null, Int32Array.of(0, 1));
    const edited: SkinWeights = {
      ...skin,
      joints: Uint16Array.from(skin.joints),
      weights: Float32Array.from(skin.weights),
    };
    edited.joints[0] = 1;
    view.updateWeights(edited, Uint32Array.of(0));
    const corners = Array.from({ length: d.data.counts.corners }, (_, cIdx) => d.data.cornerVert[cIdx]).filter(
      (v) => v === 0,
    ).length;
    expect(view.uploadedBytes).toBe(corners * 4 * (2 + 4));
    view.setWeightDisplay('greyscale', 1, null, false);
    view.setWeightDisplay('greyscale', 0, null, false);
    expect(view.uploadedBytes).toBe(0);
    expect(view.weightDisplay).toMatchObject({ mode: 'greyscale', active: 0 });
  });
});
