// CurveRenderer (ADR 0007 §8): painting is separate from interaction, so a WebGL curve layer could replace the
// Canvas2D base painter without touching the controller.
//
// M-1 mechanism 5 (M2A-SPEC §5.21.1): during a drag the curves the drag does not touch are painted once into a cached
// static layer (an offscreen canvas per static state), and each frame of the drag copies it and repaints only the
// dragged curves, their keys and handles over it.
import type { CurveId } from '@ekza-studio/doc';
import type { GraphScene, Point } from '../graph/scene';
import { beginFrame } from './canvas';
import { CurvePainterScratch, type EntryFilter, paintBuffers, paintCurves } from './curves';
import { paintBackground, paintGrid } from './grid';
import { paintHandles, paintKeys } from './keys';
import { type OverlayState, paintOverlay } from './overlay';
import type { GraphTheme } from './theme';

/** M-1: the curves a drag changes and the version of everything else (the static layer is reused while it holds). */
export interface DynamicLayers {
  readonly dynamic: ReadonlySet<CurveId>;
  /** Changes whenever anything the static layer shows changes (view, size, selection, other curves, theme). */
  readonly staticVersion: number;
}

export interface CurveRenderer {
  /**
   * Base layer: background, range shading, grid, labels, buffer curves, infinity, curves, handles, keys. With
   * `layers` (a drag in progress) only the dynamic curves are repainted over the cached static layer.
   */
  renderBase(scene: GraphScene, layers?: DynamicLayers | null): void;
  /** Overlay layer: playhead, hover, marquee, region box, drag readout. */
  renderOverlay(scene: GraphScene, state: OverlayState): void;
  dispose(): void;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext('2d', { alpha: true });
}

export class Canvas2DCurveRenderer implements CurveRenderer {
  private readonly baseCtx: CanvasRenderingContext2D | null;
  private readonly overlayCtx: CanvasRenderingContext2D | null;
  private readonly scratch = new CurvePainterScratch();
  private readonly point: Point = { x: 0, y: 0 };
  private staticCanvas: HTMLCanvasElement | null = null;
  private staticCtx: CanvasRenderingContext2D | null = null;
  /** What the static layer holds: its version, dynamic set and backing-store size. */
  private staticKey: { version: number; dynamic: ReadonlySet<CurveId>; width: number; height: number } | null = null;
  /** Static-layer repaints (tests: a drag repaints it once). */
  staticRenders = 0;

  constructor(
    private readonly base: HTMLCanvasElement,
    private readonly overlay: HTMLCanvasElement,
    private readonly theme: () => GraphTheme,
  ) {
    this.baseCtx = context2d(base);
    this.overlayCtx = context2d(overlay);
  }

  renderBase(scene: GraphScene, layers?: DynamicLayers | null): void {
    const ctx = this.baseCtx;
    if (ctx === null) return;
    const theme = this.theme();
    if (layers === null || layers === undefined || !this.paintStatic(scene, layers, theme)) {
      this.staticKey = null;
      beginFrame(ctx, this.base, scene.width, scene.height);
      this.paintLayer(ctx, scene, theme, null, true);
      return;
    }
    // The cached static layer, then the dragged curves over it.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.base.width, this.base.height);
    ctx.drawImage(this.staticCanvas as HTMLCanvasElement, 0, 0);
    const sx = scene.width > 0 ? this.base.width / scene.width : 1;
    const sy = scene.height > 0 ? this.base.height / scene.height : 1;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    const dynamic = layers.dynamic;
    this.paintLayer(ctx, scene, theme, (entry) => dynamic.has(entry.id), false);
  }

  /** Paints (or reuses) the static layer: everything but the dynamic curves. False when no offscreen canvas exists. */
  private paintStatic(scene: GraphScene, layers: DynamicLayers, theme: GraphTheme): boolean {
    if (typeof document === 'undefined') return false;
    if (this.staticCanvas === null) {
      this.staticCanvas = document.createElement('canvas');
      this.staticCtx = context2d(this.staticCanvas);
    }
    const canvas = this.staticCanvas;
    const ctx = this.staticCtx;
    if (ctx === null) return false;
    const key = this.staticKey;
    if (
      key !== null &&
      key.version === layers.staticVersion &&
      key.dynamic === layers.dynamic &&
      key.width === this.base.width &&
      key.height === this.base.height
    ) {
      return true;
    }
    if (canvas.width !== this.base.width) canvas.width = this.base.width;
    if (canvas.height !== this.base.height) canvas.height = this.base.height;
    beginFrame(ctx, canvas, scene.width, scene.height);
    const dynamic = layers.dynamic;
    this.paintLayer(ctx, scene, theme, (entry) => !dynamic.has(entry.id), true);
    this.staticKey = {
      version: layers.staticVersion,
      dynamic: layers.dynamic,
      width: this.base.width,
      height: this.base.height,
    };
    this.staticRenders++;
    return true;
  }

  /** Curves, handles and keys of the included entries; with `background` also background, grid and buffers. */
  private paintLayer(
    ctx: CanvasRenderingContext2D,
    scene: GraphScene,
    theme: GraphTheme,
    include: EntryFilter,
    background: boolean,
  ): void {
    if (background) {
      paintBackground(ctx, scene, theme);
      paintGrid(ctx, scene, theme);
      paintBuffers(ctx, scene, this.scratch, theme.curveBuffer);
    }
    paintCurves(ctx, scene, this.scratch, include);
    paintHandles(ctx, scene, theme, this.point, include);
    paintKeys(ctx, scene, theme, include);
  }

  renderOverlay(scene: GraphScene, state: OverlayState): void {
    const ctx = this.overlayCtx;
    if (ctx === null) return;
    beginFrame(ctx, this.overlay, scene.width, scene.height);
    paintOverlay(ctx, scene, state, this.theme());
  }

  dispose(): void {
    this.staticCanvas = null;
    this.staticCtx = null;
    this.staticKey = null;
  }
}
