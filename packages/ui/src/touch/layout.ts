// Geometry of the touch kit, pure (STUDIO-TOUCH-SPEC §4.1, §4.4, §6.1): the Halo's arc beside the selection and its
// row fallback, the flick ring's compass slots, a verb bar's overflow into its pinned ⋯, roving focus, sheet
// detents and the Loupe's candidate under a finger. All in container CSS px, y down.
import { TOUCH } from './constants';

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ArcInput {
  /** The selection's on-screen box: petals never overlap it (§4.1, AS-ST-18). */
  readonly target: Box;
  /** Each petal's width, in slot order (the ⋯ More petal last). */
  readonly widths: readonly number[];
  /** The container (the canvas area). */
  readonly width: number;
  readonly height: number;
  /** Chrome to stay clear of: top bar and breadcrumb above, the tray below (CSS px from the container edges). */
  readonly insetTop?: number;
  readonly insetBottom?: number;
  /** The side away from the pen hand (§4.1; handedness mirrors it). Default: left. */
  readonly prefer?: 'left' | 'right';
  readonly petalHeight?: number;
  readonly pitch?: number;
  readonly gutter?: number;
}

export interface ArcLayout {
  /** `arc`: a column beside the selection, curving away from it; `row`: a horizontal row above or below it. */
  readonly mode: 'arc' | 'row';
  readonly side: 'left' | 'right' | 'below' | 'above';
  /** Top-left corner of each petal. */
  readonly positions: readonly Point[];
  /** The thin line from the selection to the petals (§4.1 "joined to it by a thin line"). */
  readonly connector: { readonly from: Point; readonly to: Point };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Places the Halo's petals. A column on the preferred side when it has the room (at least 240 px, §4.3, and the
 * widest petal), else on the other side, else a row below the selection (above when there is no room below),
 * wrapping when wider than the container. The column bows away from the selection (the middle petal nearest), so
 * every petal stays at a thumb's reach from it.
 */
export function arcLayout(input: ArcInput): ArcLayout {
  const { target, widths, width, height } = input;
  const gutter = input.gutter ?? TOUCH.gutter;
  const h = input.petalHeight ?? TOUCH.hit;
  const pitch = input.pitch ?? TOUCH.petalPitch;
  const top = (input.insetTop ?? 0) + TOUCH.gap;
  const bottom = height - (input.insetBottom ?? 0) - TOUCH.gap;
  const n = widths.length;
  const maxW = n === 0 ? 0 : Math.max(...widths);
  const cx = (target.left + target.right) / 2;
  const cy = (target.top + target.bottom) / 2;
  const leftRoom = target.left - gutter;
  const rightRoom = width - target.right - gutter;
  const need = Math.max(TOUCH.arcMinRoom, maxW + 30);
  const prefer = input.prefer ?? 'left';
  const room = { left: leftRoom, right: rightRoom };
  const other = prefer === 'left' ? 'right' : 'left';
  const side: 'left' | 'right' | null = room[prefer] >= need ? prefer : room[other] >= need ? other : null;
  const columnHeight = (n - 1) * pitch + h;

  if (side !== null && columnHeight <= bottom - top) {
    const y0 = clamp(cy - columnHeight / 2, top, bottom - columnHeight);
    const mid = (n - 1) / 2;
    const positions = widths.map((w, i) => {
      const t = mid === 0 ? 0 : (i - mid) / mid;
      const push = 30 + 34 * t * t;
      const x = side === 'left' ? target.left - push - w : target.right + push;
      return { x: clamp(x, gutter, width - gutter - w), y: y0 + i * pitch };
    });
    const ex = side === 'left' ? target.left - 22 : target.right + 22;
    return {
      mode: 'arc',
      side,
      positions,
      connector: { from: { x: cx, y: cy }, to: { x: ex, y: clamp(cy, y0 + h / 2, y0 + columnHeight - h / 2) } },
    };
  }

  // Row: below the selection when it fits, else above; wraps at the container's gutters.
  const total = widths.reduce((a, w) => a + w, 0) + Math.max(0, n - 1) * TOUCH.gap;
  const rowsNeeded = (avail: number): number => {
    let rows = 1;
    let x = 0;
    for (const w of widths) {
      if (x > 0 && x + w > avail) {
        rows++;
        x = 0;
      }
      x += w + TOUCH.gap;
    }
    return rows;
  };
  const avail = width - 2 * gutter;
  const rows = total > avail ? rowsNeeded(avail) : 1;
  const blockHeight = (rows - 1) * pitch + h;
  const below = target.bottom + 18;
  const placeBelow = below + blockHeight <= bottom;
  const y0 = placeBelow ? below : clamp(target.top - 18 - blockHeight, top, bottom - blockHeight);
  const positions: Point[] = [];
  if (rows === 1) {
    let x = clamp(cx - total / 2, gutter, width - gutter - total);
    for (const w of widths) {
      positions.push({ x, y: y0 });
      x += w + TOUCH.gap;
    }
  } else {
    let x = gutter;
    let y = y0;
    for (const w of widths) {
      if (x > gutter && x + w > width - gutter) {
        x = gutter;
        y += pitch;
      }
      positions.push({ x, y });
      x += w + TOUCH.gap;
    }
  }
  return {
    mode: 'row',
    side: placeBelow ? 'below' : 'above',
    positions,
    connector: { from: { x: cx, y: cy }, to: { x: cx, y: placeBelow ? y0 : y0 + blockHeight } },
  };
}

export type CompassSlot = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export const COMPASS: readonly CompassSlot[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Direction of each slot (degrees, counter-clockwise from east, y up), as the marking menus use them. */
const ANGLE: Readonly<Record<CompassSlot, number>> = { E: 0, NE: 45, N: 90, NW: 135, W: 180, SW: 225, S: 270, SE: 315 };

/**
 * The flick ring (§5.2): the centre kept `ringEdgeMargin` inside the container, each slot's petal on its compass
 * direction — the petal's inner edge at `radius` from the centre, so 44 px petals clear each other — and clamped
 * into the gutters. A flick is measured from where the press started, not from the drawn centre (`slotToward`).
 */
export function ringLayout(
  center: Point,
  slots: readonly { readonly slot: CompassSlot; readonly width: number }[],
  width: number,
  height: number,
  radius = 104,
): { readonly center: Point; readonly positions: readonly Point[] } {
  const m = TOUCH.ringEdgeMargin;
  const c = { x: clamp(center.x, m, width - m), y: clamp(center.y, m, height - m) };
  const h = TOUCH.hit;
  const positions = slots.map(({ slot, width: w }) => {
    const a = (ANGLE[slot] * Math.PI) / 180;
    const px = c.x + Math.cos(a) * radius;
    const py = c.y - Math.sin(a) * radius;
    const cos = Math.cos(a);
    const x = Math.abs(cos) < 0.2 ? px - w / 2 : cos > 0 ? px - 18 : px - w + 18;
    return {
      x: clamp(x, TOUCH.gutter, width - TOUCH.gutter - w),
      y: clamp(py - h / 2, TOUCH.gutter, height - TOUCH.gutter - h),
    };
  });
  return { center: c, positions };
}

/** The compass slot a flick from the press point points at, or null inside the dead zone or between slots. */
export function slotToward(dx: number, dy: number, slots: readonly CompassSlot[] = COMPASS): CompassSlot | null {
  if (Math.hypot(dx, dy) <= TOUCH.flickPx) return null;
  const angle = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
  let best: CompassSlot | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const raw = Math.abs(angle - ANGLE[slot]);
    const delta = Math.min(raw, 360 - raw);
    if (delta < bestDelta) {
      best = slot;
      bestDelta = delta;
    }
  }
  return bestDelta <= 22.5 ? best : null;
}

/**
 * How many leading items of a row fit in `available` px next to a pinned trailing item (⋯), which never scrolls
 * away (§4.1, §4.4): the rest fold into it. Returns every item when they all fit without the pin's room.
 */
export function fitRow(
  widths: readonly number[],
  available: number,
  pinnedWidth: number,
  gap: number = TOUCH.gap,
): number {
  const all = widths.reduce((a, w) => a + w, 0) + Math.max(0, widths.length - 1) * gap;
  if (all + gap + pinnedWidth <= available) return widths.length;
  let used = pinnedWidth;
  let count = 0;
  for (const w of widths) {
    if (used + gap + w > available) break;
    used += gap + w;
    count++;
  }
  return count;
}

/**
 * Roving focus in a one-dimensional group (segmented control, menu, verb bar): the index the key moves to, skipping
 * disabled items and wrapping, or null for keys the group does not handle.
 */
export function rovingIndex(
  current: number,
  key: string,
  count: number,
  orientation: 'horizontal' | 'vertical' | 'both' = 'horizontal',
  disabled: (index: number) => boolean = () => false,
): number | null {
  if (count === 0) return null;
  const forward =
    orientation === 'vertical' ? ['ArrowDown'] : orientation === 'both' ? ['ArrowRight', 'ArrowDown'] : ['ArrowRight'];
  const back =
    orientation === 'vertical' ? ['ArrowUp'] : orientation === 'both' ? ['ArrowLeft', 'ArrowUp'] : ['ArrowLeft'];
  const step = (from: number, dir: 1 | -1): number => {
    for (let k = 1; k <= count; k++) {
      const i = (((from + dir * k) % count) + count) % count;
      if (!disabled(i)) return i;
    }
    return current;
  };
  if (forward.includes(key)) return step(current, 1);
  if (back.includes(key)) return step(current, -1);
  if (key === 'Home') return step(-1, 1);
  if (key === 'End') return step(count, -1);
  return null;
}

export type Detent = 'peek' | 'half' | 'full';
export const DETENTS: readonly Detent[] = ['peek', 'half', 'full'];

/** Height of each detent for a bottom sheet in a container of `height` px. */
export function detentHeights(height: number): Readonly<Record<Detent, number>> {
  return { peek: Math.min(176, height), half: Math.round(height * 0.5), full: Math.round(height * 0.92) };
}

/**
 * The detent a dragged grab bar settles on: a fast flick (|velocity| ≥ 0.5 px/ms) goes one detent in its direction,
 * else the nearest height. `velocity` is positive when the bar moves down (the sheet shrinks).
 */
export function snapDetent(heightPx: number, velocity: number, containerHeight: number, from: Detent): Detent {
  const heights = detentHeights(containerHeight);
  const index = DETENTS.indexOf(from);
  if (velocity <= -0.5) return DETENTS[Math.min(DETENTS.length - 1, index + 1)] ?? from;
  if (velocity >= 0.5) return DETENTS[Math.max(0, index - 1)] ?? from;
  let best: Detent = from;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const d of DETENTS) {
    const delta = Math.abs(heights[d] - heightPx);
    if (delta < bestDelta) {
      best = d;
      bestDelta = delta;
    }
  }
  return best;
}

/** The next detent a tap on the grab bar goes to: peek → half → full → half. */
export function nextDetent(from: Detent): Detent {
  return from === 'peek' ? 'half' : from === 'half' ? 'full' : 'half';
}

/** The index of the box under a point (the Loupe's slide-and-lift), or -1; boxes inflate by `slop` px. */
export function boxAt(point: Point, boxes: readonly Box[], slop = 0): number {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b === undefined) continue;
    if (point.x >= b.left - slop && point.x <= b.right + slop && point.y >= b.top - slop && point.y <= b.bottom + slop)
      return i;
  }
  return -1;
}
