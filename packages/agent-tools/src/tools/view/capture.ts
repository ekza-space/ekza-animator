// view_capture (MCP-SPEC §6.8 tool 29, §5.15; MVP cut §0.4.1 item 5): one image — a still or a contact sheet of ≤ 6
// frames from preset cameras on both sides of the character or from the user's own view — rendered by the host's
// ViewCaptureService without moving any pane camera or the playhead. Live only in the MVP: headless pictures (the
// schematic renderer, P5) are deferred (M-AI-MVP-18), so a headless call answers `unsupported` with a hint.
import type { CaptureView, CaptureTile, EditorApp, ViewCaptureService } from '@ekza-studio/editor-core';
import type { Disposer } from '@ekza-studio/anim-core';
import { checkReadFrames } from '../../resolve/targets';
import { addressed, clipInfo } from '../../runtime/toolkit';
import { isUserFrame, poseAt, restPoseOf, userFrameOf } from '../../units/pose';
import { roundTo } from '../../units/units';
import { AgentToolFailure, type AgentToolContext, type AgentToolResult } from '../../types';
import { type CaptureCrop, cropBounds, presetCamera } from './cameras';
import { CAPTURE_FRAMES_MAX, sheetLayout, thinEvenly, tileAspect, tileRect, visualTokens } from './sheet';

export interface ViewCaptureArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly frames: readonly number[] | 'keys' | 'extremes' | { readonly every: number };
  readonly views: readonly CaptureView[];
  readonly crop: CaptureCrop;
  readonly overlays?:
    | { readonly grid: boolean; readonly controls: boolean; readonly contacts: boolean; readonly trails?: unknown }
    | undefined;
  readonly withUserOverrides: boolean;
  readonly fidelity: 'auto' | 'shaded' | 'schematic';
  readonly tilePx?: number | undefined;
  readonly maxEdgePx: number;
  readonly format: 'png' | 'webp';
}

/** Views the MVP renders (§0.4.1): the user's pane camera and the presets on both sides of the character. */
export const MVP_CAPTURE_VIEWS: ReadonlySet<CaptureView> = new Set<CaptureView>([
  'user',
  'front',
  'back',
  'left',
  'right',
  'top',
  'three_quarter_left',
  'three_quarter_right',
]);

// ---------- the live service of an app (the editor tab attaches it when the agent module loads) ----------
const attached = new WeakMap<EditorApp, ViewCaptureService>();

/**
 * Attaches a capture service to an app whose services were created without one (the editor creates its services
 * before the lazy agent module loads). `app.services.viewCapture` wins when set. Returns a disposer.
 */
export function attachViewCapture(app: EditorApp, service: ViewCaptureService): Disposer {
  attached.set(app, service);
  return () => {
    if (attached.get(app) === service) attached.delete(app);
  };
}

/** The capture service of an app, or null. */
export function viewCaptureServiceOf(app: EditorApp): ViewCaptureService | null {
  return app.services.viewCapture ?? attached.get(app) ?? null;
}

// ---------- frames ----------
const SAMPLES_MAX = 2_000;
const EXTREME_BONES = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as const;

function keyFrames(app: EditorApp, clip: Parameters<typeof clipInfo>[1], range: readonly [number, number]): number[] {
  const frames = new Set<number>();
  for (const curve of app.store.query.curvesOfClip(clip)) {
    for (const key of app.store.query.keysOfCurve(curve.id)) {
      if (key.t >= range[0] - 1e-6 && key.t <= range[1] + 1e-6) frames.add(roundTo(key.t, 1e-6));
    }
  }
  return [...frames].sort((a, b) => a - b);
}

function extremeFrames(
  app: EditorApp,
  runtime: ReturnType<typeof addressed>['runtime'],
  clip: Parameters<typeof clipInfo>[1],
  range: readonly [number, number],
): number[] | null {
  const humanoid = runtime.skeleton.humanoid;
  const hips = humanoid?.hips;
  const bones = EXTREME_BONES.map((name) => humanoid?.[name]).filter((node): node is number => node !== undefined);
  if (hips === undefined || bones.length === 0) return null;
  const start = Math.ceil(range[0]);
  const end = Math.floor(range[1]);
  const step = Math.max(1, Math.ceil((end - start + 1) / SAMPLES_MAX));
  const sampled: number[] = [];
  for (let f = start; f <= end; f += step) sampled.push(f);
  const heights = sampled.map((frame) => {
    const pose = poseAt(app, runtime, clip, frame);
    const base = pose.boneWorld[hips * 16 + 13] as number;
    return bones.map((node) => (pose.boneWorld[node * 16 + 13] as number) - base);
  });
  const out = new Set<number>();
  if (sampled.length > 0) {
    out.add(sampled[0] as number);
    out.add(sampled.at(-1) as number);
  }
  for (let b = 0; b < bones.length; b++) {
    for (let i = 1; i < sampled.length - 1; i++) {
      const prev = (heights[i - 1] as number[])[b] as number;
      const here = (heights[i] as number[])[b] as number;
      const next = (heights[i + 1] as number[])[b] as number;
      if ((here > prev + 1e-5 && here >= next) || (here < prev - 1e-5 && here <= next)) out.add(sampled[i] as number);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function framesOf(
  ctx: AgentToolContext,
  args: ViewCaptureArgs,
  where: ReturnType<typeof addressed>,
  warnings: string[],
): number[] {
  const range: readonly [number, number] = [where.record.range.start, where.record.range.end];
  const spec = args.frames;
  if (Array.isArray(spec)) {
    const frames = spec as readonly number[];
    checkReadFrames(where.record, frames, 'frames');
    return [...new Set(frames)];
  }
  if (spec === 'keys' || spec === 'extremes') {
    const found =
      spec === 'extremes'
        ? (extremeFrames(ctx.app, where.runtime, where.clip.id, range) ?? keyFrames(ctx.app, where.clip.id, range))
        : keyFrames(ctx.app, where.clip.id, range);
    const frames = found.length === 0 ? [range[0]] : found;
    if (frames.length > CAPTURE_FRAMES_MAX) {
      warnings.push(`${frames.length} ${spec} frames thinned evenly to ${CAPTURE_FRAMES_MAX}.`);
    }
    return thinEvenly(frames, CAPTURE_FRAMES_MAX);
  }
  const every = (spec as { readonly every: number }).every;
  const frames: number[] = [];
  for (let f = range[0]; f <= range[1] + 1e-6 && frames.length < CAPTURE_FRAMES_MAX; f += every) frames.push(f);
  if (range[0] + every * CAPTURE_FRAMES_MAX <= range[1] + 1e-6) {
    warnings.push(`Only the first ${CAPTURE_FRAMES_MAX} frames of {every: ${every}} are shown.`);
  }
  return frames;
}

function unsupported(message: string, hint: string): AgentToolFailure {
  return new AgentToolFailure('unsupported', message, hint, { retryable: false });
}

// ---------- the tool ----------
export async function viewCapture(ctx: AgentToolContext, args: ViewCaptureArgs): Promise<AgentToolResult<unknown>> {
  if (ctx.host.mode !== 'live') {
    throw unsupported(
      'Pictures of headless projects are not available in this build.',
      'use pose_read or keys_read for numbers, or project_export and look at the file in Ekza Studio',
    );
  }
  if (args.fidelity === 'schematic') {
    throw unsupported(
      'Schematic pictures are not available in this build.',
      "call view_capture with fidelity 'auto' (shaded in the editor)",
    );
  }
  const views = [...new Set(args.views)];
  const missing = views.find((view) => !MVP_CAPTURE_VIEWS.has(view));
  if (missing !== undefined) {
    throw unsupported(
      `The '${missing}' view is not available in this build.`,
      'use user, front, back, left, right, top, three_quarter_left or three_quarter_right',
    );
  }
  const service = viewCaptureServiceOf(ctx.app);
  if (service === null || !service.fidelities.includes('shaded')) {
    throw unsupported(
      'This editor cannot render pictures (WebGL is not available).',
      'use pose_read or keys_read for numbers',
    );
  }
  const where = addressed(ctx, args);
  const warnings: string[] = [];
  const frames = framesOf(ctx, args, where, warnings);
  if (args.withUserOverrides) {
    const frame = frames[0];
    if (frames.length !== 1 || frame === undefined || !isUserFrame(ctx.app, where.character.id, where.clip.id, frame)) {
      const userFrame = userFrameOf(ctx.app, where.character.id, where.clip.id);
      throw new AgentToolFailure(
        'invalid_args',
        "withUserOverrides shows the user's unkeyed pose only at the user's current frame of the active clip.",
        userFrame === null
          ? 'drop withUserOverrides: this clip is not the one the user is looking at'
          : `pass frames: [${roundTo(userFrame, 1e-3)}] with withUserOverrides, or drop it`,
        { detail: { path: 'withUserOverrides' } },
      );
    }
  }
  const layout = sheetLayout({
    frames: frames.length,
    views: views.length,
    crop: args.crop,
    tilePx: args.tilePx,
    maxEdgePx: args.maxEdgePx,
  });
  const rest = restPoseOf(where.runtime.program);
  const bounds = cropBounds(where.runtime.skeleton, rest.boneWorld, args.crop);
  const aspect = tileAspect(args.crop);
  const tiles: CaptureTile[] = [];
  for (const view of views) {
    const camera = view === 'user' ? null : presetCamera(view, bounds, aspect);
    for (const frame of frames) {
      tiles.push({ frame, view, camera, label: `f${roundTo(frame, 1e-2)} ${view}` });
    }
  }
  ctx.focus(
    {
      character: where.character.id,
      clip: where.clip.id,
      controls: [],
      frame: frames.length === 1 ? (frames[0] as number) : null,
    },
    'Looking at the animation',
  );
  const overlays = args.overlays ?? { grid: true, controls: false, contacts: false };
  const result = await service.capture({
    character: where.character.id,
    clip: where.clip.id,
    tiles,
    tilePx: { w: layout.tileW, h: layout.tileH },
    columns: layout.columns,
    overlays: { grid: overlays.grid, controls: overlays.controls, contacts: [], trails: [] },
    fidelity: 'shaded',
    format: args.format,
    withOverrides: args.withUserOverrides,
    signal: ctx.signal,
  });
  if (overlays.contacts || (overlays.trails !== undefined && overlays.trails !== null)) {
    warnings.push('Contact marks and trails are not drawn in this build.');
  }
  const cameras: Record<string, { projection: string; positionM: number[]; targetM: number[] }> = {};
  for (const tile of result.tiles) {
    if (cameras[tile.view] !== undefined) continue;
    cameras[tile.view] = {
      projection: tile.camera.projection,
      positionM: tile.camera.position.map((v) => roundTo(v, 1e-3)),
      targetM: tile.camera.target.map((v) => roundTo(v, 1e-3)),
    };
  }
  return {
    ok: true,
    data: {
      widthPx: result.width,
      heightPx: result.height,
      fidelity: result.fidelity,
      fallbackReason: result.fallbackReason,
      visualTokens: visualTokens(result.width, result.height),
      tiles: result.tiles.map((tile, i) => ({
        frame: tile.frame,
        view: tile.view,
        rectPx: [...(tile.rect ?? tileRect(layout, frames.length, i))] as [number, number, number, number],
      })),
      cameras,
    },
    clip: clipInfo(ctx, where.clip.id),
    images: [{ bytes: result.bytes, mime: result.mime, width: result.width, height: result.height }],
    ...(warnings.length === 0 ? {} : { warnings }),
  };
}
