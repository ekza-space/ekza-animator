// MCP-SPEC §6.8 tool 29, §5.15 (MVP cut §0.4.1 item 5; B3): view_capture over a fake live capture service — preset
// cameras on both sides of the character (front shows the character's left on the image's right), the sheet layout
// (≤ 6 frames, long edge ≤ maxEdgePx), the user's view as a null camera, frames from keys / extremes / every,
// withUserOverrides only at the user's frame, and `unsupported` headless, without a service and for schematic.
import type { CaptureCamera, ViewCaptureRequest, ViewCaptureService } from '@ekza-studio/editor-core';
import Ajv2020 from 'ajv/dist/2020';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  attachViewCapture,
  buildManifest,
  cropBounds,
  presetCamera,
  sheetLayout,
  thinEvenly,
  tileRect,
  visualTokens,
} from '../src';
import {
  call,
  dataOf,
  errorOf,
  host,
  liveHost,
  type P2Fixture,
  p2Fixture,
  runtimeOf,
  seedUserSession,
  sessionRecord,
} from './p2-support';

const USER_CAMERA: CaptureCamera = {
  projection: 'perspective',
  position: [1, 1, 3],
  target: [0, 1, 0],
  up: [0, 1, 0],
  fovYDeg: 40,
  orthoHeightM: 0,
};

function fakeService(seen: ViewCaptureRequest[]): ViewCaptureService {
  return {
    fidelities: ['shaded'],
    capture(req) {
      seen.push(req);
      const views = new Set(req.tiles.map((tile) => tile.view)).size;
      const frames = req.tiles.length / views;
      const layout = sheetLayout({ frames, views, crop: 'body', maxEdgePx: 100_000 });
      const width = req.columns * req.tilePx.w;
      const height = views * layout.rowsPerView * req.tilePx.h;
      return Promise.resolve({
        bytes: new Uint8Array([137, 80, 78, 71]),
        mime: 'image/png',
        width,
        height,
        fidelity: 'shaded',
        fallbackReason: null,
        tiles: req.tiles.map((tile, i) => ({
          frame: tile.frame,
          view: tile.view,
          camera: tile.camera ?? USER_CAMERA,
          rect: tileRect({ ...layout, tileW: req.tilePx.w, tileH: req.tilePx.h }, frames, i),
        })),
      });
    },
  };
}

describe('view_capture cameras and sheet (§5.15.1, §5.15.2)', () => {
  const bounds = { min: [-0.5, 0, -0.2] as const, max: [0.5, 1.8, 0.2] as const };

  it('puts the front camera at +Z, left at +X (the character’s left), right at −X, back at −Z', () => {
    const front = presetCamera('front', { min: [...bounds.min], max: [...bounds.max] }, 0.75);
    const left = presetCamera('left', { min: [...bounds.min], max: [...bounds.max] }, 0.75);
    const right = presetCamera('right', { min: [...bounds.min], max: [...bounds.max] }, 0.75);
    const back = presetCamera('back', { min: [...bounds.min], max: [...bounds.max] }, 0.75);
    expect(front?.projection).toBe('orthographic');
    expect(front?.position[2]).toBeGreaterThan(1);
    expect(left?.position[0]).toBeGreaterThan(1);
    expect(right?.position[0]).toBeLessThan(-1);
    expect(back?.position[2]).toBeLessThan(-1);
    // tall bounds in a 3:4 tile: the height fits with the padding
    expect(front?.orthoHeightM).toBeCloseTo(1.8 * 1.1, 6);
    const q = presetCamera('three_quarter_left', { min: [...bounds.min], max: [...bounds.max] }, 0.75);
    expect(q?.projection).toBe('perspective');
    expect(q?.position[0]).toBeGreaterThan(0);
    expect(q?.position[2]).toBeGreaterThan(0);
    expect(
      presetCamera('three_quarter_right', { min: [...bounds.min], max: [...bounds.max] }, 0.75)?.position[0],
    ).toBeLessThan(0);
    expect(presetCamera('user', { min: [...bounds.min], max: [...bounds.max] }, 1)).toBeNull();
  });

  it('lays tiles out by frame count, one row block per view, and keeps the long edge within maxEdgePx', () => {
    const one = sheetLayout({ frames: 1, views: 1, crop: 'body', maxEdgePx: 1_024 });
    expect([one.widthPx, one.heightPx]).toEqual([384, 512]);
    const six = sheetLayout({ frames: 6, views: 2, crop: 'body', maxEdgePx: 1_024 });
    expect(six.columns).toBe(4);
    expect(six.rowsPerView).toBe(2);
    expect(Math.max(six.widthPx, six.heightPx)).toBeLessThanOrEqual(1_024);
    expect(tileRect(six, 6, 6)).toEqual([0, 2 * six.tileH, six.tileW, six.tileH]); // view 2 starts a new block
    const three = sheetLayout({ frames: 1, views: 3, crop: 'head', maxEdgePx: 1_024 });
    expect(Math.max(three.widthPx, three.heightPx)).toBeLessThanOrEqual(1_024);
    expect(visualTokens(768, 512)).toBe(28 * 19);
    expect(thinEvenly([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 6)).toEqual([0, 2, 4, 5, 7, 9]);
  });
});

describe('view_capture (§6.8 tool 29, live)', () => {
  let fx: P2Fixture;
  const seen: ViewCaptureRequest[] = [];
  beforeAll(async () => {
    fx = await p2Fixture(61);
    attachViewCapture(fx.tools, fakeService(seen));
  });

  it('renders a still of the user’s view and preset sheets with cameras and one image', async () => {
    const runtime = runtimeOf(fx, liveHost());
    const still = await call(runtime, 'view_capture', { clip: 'agent', frames: [0], views: ['user'] });
    const data = dataOf<{
      widthPx: number;
      heightPx: number;
      fidelity: string;
      tiles: unknown[];
      cameras: Record<string, unknown>;
    }>(still);
    expect(data.fidelity).toBe('shaded');
    expect(Math.max(data.widthPx, data.heightPx)).toBeLessThanOrEqual(1_024);
    expect(seen.at(-1)?.tiles[0]?.camera).toBeNull();
    expect(still.ok && still.images?.length).toBe(1);

    const sheet = await call(runtime, 'view_capture', { clip: 'agent', frames: [0, 15, 30], views: ['front', 'left'] });
    const sheetData = dataOf<{
      tiles: { frame: number; view: string }[];
      cameras: Record<string, { projection: string }>;
    }>(sheet);
    expect(sheetData.tiles.map((tile) => `${tile.view}@${tile.frame}`)).toEqual([
      'front@0',
      'front@15',
      'front@30',
      'left@0',
      'left@15',
      'left@30',
    ]);
    expect(Object.keys(sheetData.cameras)).toEqual(['front', 'left']);
    expect(seen.at(-1)?.columns).toBe(3);
    expect(seen.at(-1)?.tiles[0]?.label).toBe('f0 front');
  });

  it('picks frames from keys and {every}, at most six', async () => {
    const runtime = runtimeOf(fx, liveHost());
    await call(runtime, 'view_capture', { clip: 'agent', frames: 'keys' });
    expect(seen.at(-1)?.tiles.map((tile) => tile.frame)).toEqual([0, 15, 30]);
    const every = await call(runtime, 'view_capture', { clip: 'agent', frames: { every: 2 } });
    expect(seen.at(-1)?.tiles).toHaveLength(6);
    expect(every.ok && every.warnings?.[0]).toContain('first 6');
    const extremes = await call(runtime, 'view_capture', { clip: 'agent', frames: 'extremes' });
    expect(extremes.ok).toBe(true);
    expect(seen.at(-1)?.tiles.length).toBeLessThanOrEqual(6);
    expect(errorOf(await call(runtime, 'view_capture', { clip: 'agent', frames: [0, 1, 2, 3, 4, 5, 6] })).code).toBe(
      'invalid_args',
    );
  });

  it('refuses withUserOverrides away from the user’s frame, schematic, unknown views and headless calls', async () => {
    const runtime = runtimeOf(fx, liveHost());
    expect(
      errorOf(await call(runtime, 'view_capture', { clip: 'agent', frames: [5], withUserOverrides: true })).code,
    ).toBe('invalid_args');
    expect(
      errorOf(await call(runtime, 'view_capture', { clip: 'agent', frames: [0], fidelity: 'schematic' })).code,
    ).toBe('unsupported');
    expect(errorOf(await call(runtime, 'view_capture', { clip: 'agent', frames: [0], views: ['follow'] })).code).toBe(
      'unsupported',
    );
    const headless = errorOf(await call(runtimeOf(fx, host()), 'view_capture', { clip: 'agent', frames: [0] }));
    expect(headless.code).toBe('unsupported');
    expect(headless.hint).toContain('pose_read');
  });

  it('frames the rest skeleton: the body crop reaches the floor and the skeleton height', () => {
    const runtime = fx.app.characters.get(fx.character);
    if (runtime === undefined) throw new Error('no runtime');
    const pose = runtime.program.allocPose();
    runtime.program.evaluate(runtime.program.allocChannels(), pose);
    const body = cropBounds(runtime.skeleton, pose.boneWorld, 'body');
    expect(body.min[1]).toBeLessThanOrEqual(0);
    expect(body.max[1]).toBeGreaterThanOrEqual(runtime.skeleton.height - 1e-9);
    const head = cropBounds(runtime.skeleton, pose.boneWorld, 'head');
    expect(head.min[1]).toBeGreaterThan(body.min[1] + 0.5);
  });

  it('validates against its advertised outputSchema and leaves the user’s session state alone', async () => {
    seedUserSession(fx);
    const before = sessionRecord(fx.app);
    const store = fx.app.store.version;
    const runtime = runtimeOf(fx, liveHost());
    const result = await call(runtime, 'view_capture', { clip: 'agent', frames: [0, 30], views: ['user', 'front'] });
    const entry = buildManifest().tools.find((tool) => tool.name === 'view_capture');
    expect(entry).toBeDefined();
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const validate = ajv.compile(entry?.outputSchema ?? {});
    const envelope: unknown = JSON.parse(JSON.stringify({ ...result, images: undefined }));
    expect(validate(envelope) ? 'valid' : ajv.errorsText(validate.errors)).toBe('valid');
    expect(sessionRecord(fx.app)).toEqual(before);
    expect(fx.app.store.version).toBe(store);
    expect(fx.app.history.peekUndo()?.actor ?? null).toBeNull();
  });
});
