// The live ViewCaptureService of the tab (MCP-SPEC §5.15.3; MVP cut §0.4.1 item 5): every tile is posed from
// `evaluation.evaluateAt` (the keyed animation, plus the user's unkeyed overrides only when the call asked for them)
// and rendered offscreen through the viewport's agent host (`renderAgentTile`), then the tiles are composed into one
// sheet with their labels burned into the top-left corner and encoded as PNG (or WebP). No pane camera, no session
// field and no playhead changes; nothing waits for requestAnimationFrame. Part of the lazy agent module.
import { AgentToolFailure, sheetLayout, tileRect } from '@ekza-studio/agent-tools';
import { quatInvert, quatRotateVec3, type ReadonlyXf, type Vec3 } from '@ekza-studio/anim-core';
import type {
  CaptureCamera,
  CaptureView,
  EditorApp,
  ViewCaptureRequest,
  ViewCaptureResult,
  ViewCaptureService,
} from '@ekza-studio/editor-core';
import { type AgentTileCamera, renderAgentTile, type ViewportManager } from '@ekza-studio/viewport';

type Placement = ReadonlyXf;
const IDENTITY: Placement = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };

/** Character space → scene space (uniform scale assumed, as character placements are). */
export function toScene(xf: Placement, p: readonly number[]): Vec3 {
  const s = xf.s[0];
  const r = quatRotateVec3(xf.q, [(p[0] as number) * s, (p[1] as number) * s, (p[2] as number) * s]);
  return [r[0] + xf.t[0], r[1] + xf.t[1], r[2] + xf.t[2]];
}

/** Scene space → character space. */
export function toCharacter(xf: Placement, p: readonly number[]): Vec3 {
  const s = xf.s[0] === 0 ? 1 : xf.s[0];
  const r = quatRotateVec3(quatInvert(xf.q), [
    (p[0] as number) - xf.t[0],
    (p[1] as number) - xf.t[1],
    (p[2] as number) - xf.t[2],
  ]);
  return [r[0] / s, r[1] / s, r[2] / s];
}

function sceneCamera(camera: CaptureCamera, xf: Placement): AgentTileCamera {
  const scale = xf.s[0];
  return {
    kind: 'look',
    projection: camera.projection,
    position: toScene(xf, camera.position),
    target: toScene(xf, camera.target),
    up: quatRotateVec3(xf.q, camera.up),
    fovYDeg: camera.fovYDeg,
    orthoHeightM: camera.orthoHeightM * scale,
  };
}

function round(v: Vec3): Vec3 {
  return [Math.round(v[0] * 1e4) / 1e4, Math.round(v[1] * 1e4) / 1e4, Math.round(v[2] * 1e4) / 1e4];
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function sheetCanvas(
  width: number,
  height: number,
): {
  readonly ctx: Canvas2D;
  encode(mime: 'image/png' | 'image/webp'): Promise<Blob>;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('2D canvas unavailable');
    return { ctx, encode: (type) => canvas.convertToBlob({ type }) };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2D canvas unavailable');
  return {
    ctx,
    encode: (type) =>
      new Promise((resolve, reject) =>
        canvas.toBlob((blob) => (blob === null ? reject(new Error('encode failed')) : resolve(blob)), type),
      ),
  };
}

function drawLabel(ctx: Canvas2D, text: string, x: number, y: number, tileW: number): void {
  const size = Math.max(9, Math.min(14, Math.round(tileW / 18)));
  ctx.font = `${size}px ui-monospace, Menlo, monospace`;
  const pad = 3;
  const width = Math.min(tileW - 2, ctx.measureText(text).width + pad * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(x + 1, y + 1, width, size + pad * 2);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x + 1 + pad, y + 1 + pad, tileW - 2 - pad * 2);
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function cancelled(): AgentToolFailure {
  return new AgentToolFailure('cancelled', 'The capture was cancelled.', 'call view_capture again', {
    retryable: true,
  });
}

/** The capture service of a live editor tab. `viewport` returns the editor's ViewportManager (null without WebGL). */
export function createLiveViewCapture(app: EditorApp, viewport: () => ViewportManager | null): ViewCaptureService {
  return {
    fidelities: ['shaded'],
    async capture(req: ViewCaptureRequest): Promise<ViewCaptureResult> {
      const vm = viewport();
      if (vm === null) {
        throw new AgentToolFailure(
          'unsupported',
          'This editor has no viewport to render pictures with (WebGL is not available).',
          'use pose_read or keys_read for numbers',
          { retryable: false },
        );
      }
      const runtime = app.characters.get(req.character);
      if (runtime === undefined) {
        throw new AgentToolFailure('not_found', 'The character is not loaded.', 'scene_summary lists the characters');
      }
      const host = await vm.agentHost();
      if (isAborted(req.signal)) throw cancelled();
      const placement = app.store.get('characters', req.character)?.placement ?? IDENTITY;
      const views: CaptureView[] = [];
      for (const tile of req.tiles) if (!views.includes(tile.view)) views.push(tile.view);
      const frames = Math.max(1, Math.round(req.tiles.length / views.length));
      const rows = Math.ceil(frames / req.columns);
      const layout = {
        ...sheetLayout({ frames, views: views.length, crop: 'body', maxEdgePx: 100_000 }),
        tileW: req.tilePx.w,
        tileH: req.tilePx.h,
        columns: req.columns,
        rowsPerView: rows,
      };
      const width = req.columns * req.tilePx.w;
      const height = views.length * rows * req.tilePx.h;
      const sheet = sheetCanvas(width, height);
      sheet.ctx.fillStyle = '#26272b';
      sheet.ctx.fillRect(0, 0, width, height);

      let userCamera: { readonly scene: AgentTileCamera; readonly character: CaptureCamera } | null = null;
      const userOf = (): NonNullable<typeof userCamera> => {
        if (userCamera !== null) return userCamera;
        const pane = host.activePaneId() ?? vm.paneIds()[0] ?? null;
        if (pane === null) {
          throw new AgentToolFailure(
            'unsupported',
            'No viewport pane is open, so there is no user view to look through.',
            "use a preset view such as 'front'",
            { retryable: false },
          );
        }
        const snapshot = host.paneCamera(pane);
        const up = quatRotateVec3(snapshot.quaternion, [0, 1, 0]);
        userCamera = {
          scene: { kind: 'snapshot', snapshot },
          character: {
            projection: snapshot.projection,
            position: round(toCharacter(placement, snapshot.position)),
            target: round(toCharacter(placement, snapshot.target)),
            up: round(quatRotateVec3(quatInvert(placement.q), up)),
            fovYDeg: (snapshot.fovY * 180) / Math.PI,
            orthoHeightM: snapshot.orthoHeight / (placement.s[0] === 0 ? 1 : placement.s[0]),
          },
        };
        return userCamera;
      };

      const pose = runtime.program.allocPose();
      const tiles: ViewCaptureResult['tiles'][number][] = [];
      for (let i = 0; i < req.tiles.length; i++) {
        if (isAborted(req.signal)) throw cancelled();
        const tile = req.tiles[i] as ViewCaptureRequest['tiles'][number];
        const camera =
          tile.camera === null ? userOf() : { scene: sceneCamera(tile.camera, placement), character: tile.camera };
        app.evaluation.evaluateAt(req.character, req.clip, tile.frame, pose, { withOverrides: req.withOverrides });
        let rendered: ReturnType<typeof renderAgentTile>;
        try {
          rendered = renderAgentTile(host, {
            character: req.character,
            boneWorld: pose.boneWorld,
            camera: camera.scene,
            width: req.tilePx.w,
            height: req.tilePx.h,
            grid: req.overlays.grid,
          });
        } catch (error) {
          throw new AgentToolFailure(
            'unsupported',
            `The editor could not render the picture (${error instanceof Error ? error.message : 'WebGL error'}).`,
            'try again later, or use pose_read for numbers',
            { retryable: true },
          );
        }
        const rect = tileRect(layout, frames, i);
        const image = new ImageData(rendered.rgba as Uint8ClampedArray<ArrayBuffer>, rendered.width, rendered.height);
        sheet.ctx.putImageData(image, rect[0], rect[1]);
        drawLabel(sheet.ctx, tile.label, rect[0], rect[1], rect[2]);
        tiles.push({ frame: tile.frame, view: tile.view, camera: camera.character, rect });
      }
      const mime = req.format === 'webp' ? 'image/webp' : 'image/png';
      const blob = await sheet.encode(mime);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return { bytes, mime, width, height, fidelity: 'shaded', tiles, fallbackReason: null };
    },
  };
}
