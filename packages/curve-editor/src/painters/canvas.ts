// hi-DPI canvas helpers (ADR 0007 §2): backing stores in device pixels, drawing in CSS px.

/** Sizes the backing store to the CSS size × DPR (rounded); returns true when it changed. */
export function sizeBackingStore(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number, dpr: number): boolean {
  const width = Math.max(0, Math.round(cssWidth * dpr));
  const height = Math.max(0, Math.round(cssHeight * dpr));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

/** Resets the transform to CSS px (scaled by the backing-store ratio) and clears the canvas. */
export function beginFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sx = cssWidth > 0 ? canvas.width / cssWidth : 1;
  const sy = cssHeight > 0 ? canvas.height / cssHeight : 1;
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

/** A pixel-centre coordinate for crisp 1 px lines. */
export function crisp(value: number): number {
  return Math.round(value) + 0.5;
}
