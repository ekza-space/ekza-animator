// view_capture sheet layout (MCP-SPEC §5.15.2, MVP cut §0.4.1 item 5: ≤ 6 frames, 1…3 views): tile aspect by crop,
// tile size by frame count, columns, one block of rows per view, and a uniform scale-down so the long edge stays
// within `maxEdgePx`. The tool and the live capture service share it, so the rectangles agree.
import type { CaptureCrop } from './cameras';

/** Frames of one sheet in the MVP (§0.4.1: a contact sheet of ≤ 6 frames). */
export const CAPTURE_FRAMES_MAX = 6;
export const CAPTURE_VIEWS_MAX = 3;
export const DEFAULT_MAX_EDGE_PX = 1_024;

export interface SheetLayout {
  readonly tileW: number;
  readonly tileH: number;
  readonly columns: number;
  /** Rows of one view's block. */
  readonly rowsPerView: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Width / height of a tile: body and legs are portrait 3:4, the close-ups square. */
export function tileAspect(crop: CaptureCrop): number {
  return crop === 'body' || crop === 'legs' ? 3 / 4 : 1;
}

export function sheetLayout(opts: {
  readonly frames: number;
  readonly views: number;
  readonly crop: CaptureCrop;
  readonly tilePx?: number | undefined;
  readonly maxEdgePx: number;
}): SheetLayout {
  const frames = Math.max(1, opts.frames);
  const views = Math.max(1, opts.views);
  const long = opts.tilePx ?? (frames === 1 ? 512 : frames <= 8 ? 256 : 192);
  const aspect = tileAspect(opts.crop);
  let tileW = aspect >= 1 ? long : Math.round(long * aspect);
  let tileH = aspect >= 1 ? Math.round(long / aspect) : long;
  const columns = frames <= 4 ? frames : frames <= 8 ? 4 : 8;
  const rowsPerView = Math.ceil(frames / columns);
  const edge = Math.max(columns * tileW, views * rowsPerView * tileH);
  if (edge > opts.maxEdgePx) {
    const scale = opts.maxEdgePx / edge;
    tileW = Math.max(1, Math.floor(tileW * scale));
    tileH = Math.max(1, Math.floor(tileH * scale));
  }
  return {
    tileW,
    tileH,
    columns,
    rowsPerView,
    widthPx: columns * tileW,
    heightPx: views * rowsPerView * tileH,
  };
}

/** The rectangle `[x, y, w, h]` (pixels, top-left origin) of tile `index` (view-major, frames in order). */
export function tileRect(layout: SheetLayout, frames: number, index: number): [number, number, number, number] {
  const view = Math.floor(index / frames);
  const i = index % frames;
  const col = i % layout.columns;
  const row = view * layout.rowsPerView + Math.floor(i / layout.columns);
  return [col * layout.tileW, row * layout.tileH, layout.tileW, layout.tileH];
}

/** Claude's image token estimate (§5.15.2): ⌈w/28⌉ × ⌈h/28⌉. */
export function visualTokens(width: number, height: number): number {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

/** `max` frames picked evenly from a sorted list (first and last kept). */
export function thinEvenly(frames: readonly number[], max: number): number[] {
  if (frames.length <= max) return [...frames];
  if (max === 1) return [frames[0] as number];
  const out: number[] = [];
  for (let k = 0; k < max; k++) out.push(frames[Math.round((k * (frames.length - 1)) / (max - 1))] as number);
  return [...new Set(out)];
}
