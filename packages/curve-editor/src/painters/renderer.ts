// CurveRenderer (ADR 0007 §8): painting is separate from interaction, so a WebGL curve layer could replace the
// Canvas2D base painter without touching the controller.
import type { GraphScene, Point } from '../graph/scene';
import { beginFrame } from './canvas';
import { CurvePainterScratch, paintCurves } from './curves';
import { paintBackground, paintGrid } from './grid';
import { paintHandles, paintKeys } from './keys';
import { type OverlayState, paintOverlay } from './overlay';
import type { GraphTheme } from './theme';

export interface CurveRenderer {
  /** Base layer: background, range shading, grid, labels, infinity, curves, handles, keys. */
  renderBase(scene: GraphScene): void;
  /** Overlay layer: playhead, hover, marquee, drag readout. */
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

  constructor(
    private readonly base: HTMLCanvasElement,
    private readonly overlay: HTMLCanvasElement,
    private readonly theme: () => GraphTheme,
  ) {
    this.baseCtx = context2d(base);
    this.overlayCtx = context2d(overlay);
  }

  renderBase(scene: GraphScene): void {
    const ctx = this.baseCtx;
    if (ctx === null) return;
    const theme = this.theme();
    beginFrame(ctx, this.base, scene.width, scene.height);
    paintBackground(ctx, scene, theme);
    paintGrid(ctx, scene, theme);
    paintCurves(ctx, scene, this.scratch);
    paintHandles(ctx, scene, theme, this.point);
    paintKeys(ctx, scene, theme);
  }

  renderOverlay(scene: GraphScene, state: OverlayState): void {
    const ctx = this.overlayCtx;
    if (ctx === null) return;
    beginFrame(ctx, this.overlay, scene.width, scene.height);
    paintOverlay(ctx, scene, state, this.theme());
  }

  dispose(): void {}
}
