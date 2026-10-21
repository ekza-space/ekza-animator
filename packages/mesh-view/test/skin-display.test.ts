// The weight display (M6B-SPEC §5.12, §5.25; C6) on a real WebGL canvas: greyscale shows the active influence's weight
// (white where 1, black where 0), switching the active influence or the mode uploads 0 bytes to the GPU and compiles no
// program, influence colours tint each bone's region, unweighted points read `--danger`, and `off` hides it.
import { primitive, type SkinWeights } from '@ekza-studio/mesh-core';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHT_COLORS, influenceColor, SkinnedSurface, WeightDisplay } from '../src';
import { type Canvas, canvas, DISPLAY, derived, LAYERS, orthoFront, screen, THEME } from './support';

let c: Canvas | null = null;
const views: SkinnedSurface[] = [];
const displays: WeightDisplay[] = [];
afterEach(() => {
  for (const display of displays.splice(0)) display.dispose();
  for (const view of views.splice(0)) view.dispose();
  c?.dispose();
  c = null;
});

/** The arm box of skinned.test.ts: x ≤ 0 on bone 0, the rest on bone 1; one unweighted point when asked. */
function arm(unweighted = false) {
  const d = derived(primitive('cube', { width: 1, height: 0.2, depth: 0.2, subdivisionsWidth: 4 }));
  const P = d.data.counts.points;
  const joints = new Uint16Array(4 * P);
  const weights = new Float32Array(4 * P);
  for (let p = 0; p < P; p++) {
    joints[4 * p] = (d.data.position[3 * p] as number) > 1e-6 ? 1 : 0;
    weights[4 * p] = unweighted && (d.data.position[3 * p] as number) > 0.49 ? 0 : 1;
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

/** Bytes passed to bufferData/bufferSubData while `fn` runs (the GPU uploads of a frame). */
function uploads(gl: WebGL2RenderingContext, fn: () => void): number {
  const data = gl.bufferData.bind(gl);
  const sub = gl.bufferSubData.bind(gl);
  let bytes = 0;
  const size = (value: unknown): number =>
    typeof value === 'number' ? value : ((value as ArrayBufferView | null)?.byteLength ?? 0);
  gl.bufferData = ((...args: unknown[]) => {
    bytes += size(args[1]);
    return (data as (...a: unknown[]) => void)(...args);
  });
  gl.bufferSubData = ((...args: unknown[]) => {
    bytes += size(args[2]);
    return (sub as (...a: unknown[]) => void)(...args);
  });
  try {
    fn();
  } finally {
    gl.bufferData = data;
    gl.bufferSubData = sub;
  }
  return bytes;
}

function setup(unweighted = false) {
  const { d, skin } = arm(unweighted);
  const view = new SkinnedSurface({ theme: THEME, layers: LAYERS });
  views.push(view);
  view.setData(d.data, d.tri, d.normals, skin, null, Int32Array.of(0, 1));
  const display = new WeightDisplay(view.root);
  displays.push(display);
  c = canvas();
  c.scene.add(view.root);
  const camera = orthoFront(3);
  camera.layers.enableAll();
  view.applyPane(DISPLAY);
  return { view, display, camera, canvas: c };
}

const grey = (rgba: readonly number[]): number => ((rgba[0] as number) + (rgba[1] as number) + (rgba[2] as number)) / 3;

describe('WeightDisplay', () => {
  it('greyscale shows the active influence; switching it uploads 0 bytes and compiles nothing', () => {
    const { display, camera, canvas: cv } = setup();
    const upper = screen(camera, [-0.3, 0, 0], 400, 300);
    const lower = screen(camera, [0.3, 0, 0], 400, 300);
    display.set('greyscale', 1);
    cv.render(camera);
    expect(grey(cv.pixel(...lower))).toBeGreaterThan(150);
    expect(grey(cv.pixel(...upper))).toBeLessThan(60);
    const gl = cv.renderer.getContext() as WebGL2RenderingContext;
    const programs = cv.renderer.info.programs?.length ?? 0;
    const bytes = uploads(gl, () => {
      display.set('greyscale', 0);
      cv.render(camera);
    });
    expect(bytes).toBe(0);
    expect(cv.renderer.info.programs?.length ?? 0).toBe(programs);
    expect(grey(cv.pixel(...lower))).toBeLessThan(60);
    expect(grey(cv.pixel(...upper))).toBeGreaterThan(150);
    // The mode switch is a uniform too.
    expect(
      uploads(gl, () => {
        display.set('ramp', 0);
        cv.render(camera);
      }),
    ).toBe(0);
    expect(cv.renderer.info.programs?.length ?? 0).toBe(programs);
  });

  it('influence colours tint each bone; unweighted points read danger; off hides the display', () => {
    const { display, camera, canvas: cv } = setup(true);
    display.set('influences', 0);
    cv.render(camera);
    const upper = cv.pixel(...screen(camera, [-0.3, 0, 0], 400, 300));
    const lower = cv.pixel(...screen(camera, [0.3, 0, 0], 400, 300));
    expect(upper.slice(0, 3)).not.toEqual(lower.slice(0, 3));
    expect(influenceColor(0)).not.toEqual(influenceColor(1));
    // The unweighted end of the box (x > 0.49) is drawn in --danger.
    const end = cv.pixel(...screen(camera, [0.497, 0, 0], 400, 300));
    expect(end[0]).toBeGreaterThan(end[2]);
    expect(DEFAULT_WEIGHT_COLORS.danger).toBe(0xef6b6b);
    display.set('off', 0);
    expect(display.state.visible).toBe(false);
    display.set('greyscale', 1);
    expect(display.state).toEqual({ mode: 'greyscale', active: 1, visible: true });
  });
});
