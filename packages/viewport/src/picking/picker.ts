// Analytic screen-space picking of controls and joints (ADR 0006 §5, MVP-SPEC §4.11.16): scene-space polylines are
// projected per pane (cached until the camera, pose or control set changes), hits are segments within 6 CSS px,
// candidates are ordered by screen distance, then depth, then control size, and the marquee uses the crossing test.
import type { CharacterId, ControlId } from '@ekza-studio/doc';
import type { ControlEntry } from '../controls/ControlLayer';
import { PICK } from '../theme';
import type { MarqueeRect, ScreenPoint } from '../types';
import { normalizeRect, type PaneProjector, pointSegmentDistance, segmentIntersectsRect } from './geometry';

/** A control under the pointer. `depth` is the view-space depth (metres) at the closest point. */
export interface ControlHit {
  readonly control: ControlId;
  readonly character: CharacterId;
  readonly distancePx: number;
  readonly depth: number;
  readonly size: number;
}

/** A joint (bone origin) under the pointer. */
export interface JointHit {
  readonly character: CharacterId;
  readonly node: number;
  readonly distancePx: number;
  readonly depth: number;
}

/** Bone origins of one character in scene space (xyz per node), for joint picking when the skeleton is shown. */
export interface JointSet {
  readonly character: CharacterId;
  readonly positions: Float32Array;
}

/**
 * Screen distances in the same bucket of this many CSS px count as equally under the pointer; the nearer control
 * (depth) then wins (MVP-SPEC §4.11.16, v0.3 integration: acceptance round 2).
 */
export const DISTANCE_TIE_PX = 1;

/** Depths closer than this (metres) count as a tie, decided by control size (MVP-SPEC §4.11.16). */
const DEPTH_TIE = 0.01;

interface PaneCache {
  key: string;
  readonly projected: Map<ControlId, Float64Array>;
}

/**
 * Projection cache and queries for one ViewportManager. `key` identifies everything the projection depends on
 * (camera matrices, pane size, control layer version); a different key reprojects.
 */
export class ControlPicker {
  private readonly panes = new Map<string, PaneCache>();
  private readonly tmp = new Float64Array(6);
  private readonly dist = new Float64Array(2);

  forget(paneId: string): void {
    this.panes.delete(paneId);
  }

  /** Projected segments of every visible control in a pane: [x0, y0, d0, x1, y1, d1] per segment, NaN when clipped. */
  projections(
    paneId: string,
    key: string,
    projector: PaneProjector,
    entries: Iterable<ControlEntry>,
  ): ReadonlyMap<ControlId, Float64Array> {
    let cache = this.panes.get(paneId);
    if (cache !== undefined && cache.key === key) return cache.projected;
    cache = { key, projected: new Map() };
    this.panes.set(paneId, cache);
    const tmp = this.tmp;
    for (const entry of entries) {
      if (!entry.visible) continue;
      const out = new Float64Array(entry.segments * 6);
      const w = entry.world;
      for (let s = 0; s < entry.segments; s++) {
        const o = s * 6;
        const ok = projector.projectSegment(
          w[o] as number,
          w[o + 1] as number,
          w[o + 2] as number,
          w[o + 3] as number,
          w[o + 4] as number,
          w[o + 5] as number,
          tmp,
        );
        if (ok) out.set(tmp, o);
        else out.fill(Number.NaN, o, o + 6);
      }
      cache.projected.set(entry.id, out);
    }
    return cache.projected;
  }

  /** Controls within the pick tolerance of (x, y), in {@link compareHits} order. */
  controlHits(
    projected: ReadonlyMap<ControlId, Float64Array>,
    entries: ReadonlyMap<ControlId, ControlEntry>,
    x: number,
    y: number,
    tolerancePx: number = PICK.controlPx,
  ): ControlHit[] {
    const hits: ControlHit[] = [];
    const dist = this.dist;
    for (const [id, segs] of projected) {
      const entry = entries.get(id);
      if (entry === undefined) continue;
      let best = Number.POSITIVE_INFINITY;
      let bestDepth = Number.POSITIVE_INFINITY;
      for (let o = 0; o < segs.length; o += 6) {
        const x0 = segs[o] as number;
        if (Number.isNaN(x0)) continue;
        const d = pointSegmentDistance(
          x,
          y,
          x0,
          segs[o + 1] as number,
          segs[o + 3] as number,
          segs[o + 4] as number,
          dist,
        );
        if (d < best || (d === best && depthAt(segs, o, dist[1] as number) < bestDepth)) {
          best = d;
          bestDepth = depthAt(segs, o, dist[1] as number);
        }
      }
      if (best <= tolerancePx) {
        hits.push({ control: id, character: entry.character, distancePx: best, depth: bestDepth, size: entry.size });
      }
    }
    return hits.sort(compareHits);
  }

  /** Visible controls whose projected polyline crosses or lies inside the rectangle, in layer order. */
  marquee(projected: ReadonlyMap<ControlId, Float64Array>, rect: MarqueeRect): ControlId[] {
    const r = normalizeRect(rect);
    const out: ControlId[] = [];
    for (const [id, segs] of projected) {
      for (let o = 0; o < segs.length; o += 6) {
        const x0 = segs[o] as number;
        if (Number.isNaN(x0)) continue;
        if (
          segmentIntersectsRect(
            x0,
            segs[o + 1] as number,
            segs[o + 3] as number,
            segs[o + 4] as number,
            r.x0,
            r.y0,
            r.x1,
            r.y1,
          )
        ) {
          out.push(id);
          break;
        }
      }
    }
    return out;
  }

  /**
   * The point of a control's polyline (segment ends and midpoints inside the pane) that is farthest from every other
   * visible control's polyline, with that separation. Clicking it picks the control whenever separation ≥ 6 px.
   */
  bestPickPoint(
    projected: ReadonlyMap<ControlId, Float64Array>,
    control: ControlId,
    width: number,
    height: number,
  ): { readonly point: ScreenPoint; readonly separationPx: number } | null {
    const own = projected.get(control);
    if (own === undefined) return null;
    const dist = this.dist;
    let best: { point: ScreenPoint; separationPx: number } | null = null;
    const consider = (px: number, py: number, depth: number): void => {
      if (px < 1 || py < 1 || px > width - 1 || py > height - 1) return;
      let separation = Number.POSITIVE_INFINITY;
      for (const [id, segs] of projected) {
        if (id === control) continue;
        for (let o = 0; o < segs.length; o += 6) {
          const x0 = segs[o] as number;
          if (Number.isNaN(x0)) continue;
          const d = pointSegmentDistance(
            px,
            py,
            x0,
            segs[o + 1] as number,
            segs[o + 3] as number,
            segs[o + 4] as number,
            dist,
          );
          if (d < separation) separation = d;
          if (best !== null && separation <= best.separationPx) return;
        }
      }
      if (best === null || separation > best.separationPx)
        best = { point: { x: px, y: py, depth }, separationPx: separation };
    };
    for (let o = 0; o < own.length; o += 6) {
      const x0 = own[o] as number;
      if (Number.isNaN(x0)) continue;
      const y0 = own[o + 1] as number;
      const x1 = own[o + 3] as number;
      const y1 = own[o + 4] as number;
      consider((x0 + x1) / 2, (y0 + y1) / 2, ((own[o + 2] as number) + (own[o + 5] as number)) / 2);
      consider(x0, y0, own[o + 2] as number);
    }
    return best;
  }

  /** Joints within the pick tolerance, nearest depth first. */
  jointHits(
    sets: Iterable<JointSet>,
    projector: PaneProjector,
    x: number,
    y: number,
    tolerancePx: number = PICK.jointPx,
  ): JointHit[] {
    const hits: JointHit[] = [];
    const tmp = this.tmp;
    for (const set of sets) {
      const p = set.positions;
      for (let node = 0; node * 3 < p.length; node++) {
        if (!projector.project(p[node * 3] as number, p[node * 3 + 1] as number, p[node * 3 + 2] as number, tmp))
          continue;
        const d = Math.hypot((tmp[0] as number) - x, (tmp[1] as number) - y);
        if (d <= tolerancePx) hits.push({ character: set.character, node, distancePx: d, depth: tmp[2] as number });
      }
    }
    return hits.sort((a, b) => a.depth - b.depth || a.distancePx - b.distancePx || a.node - b.node);
  }
}

function depthAt(segs: Float64Array, o: number, t: number): number {
  const d0 = segs[o + 2] as number;
  return d0 + ((segs[o + 5] as number) - d0) * t;
}

/**
 * Screen-distance buckets of DISTANCE_TIE_PX first (a click on a control's own curve picks it, even with another
 * control nearer the camera a few pixels away), then depth buckets of DEPTH_TIE, then size, distance and id for a
 * deterministic order. Buckets keep the order transitive.
 */
export function compareHits(a: ControlHit, b: ControlHit): number {
  const pa = Math.floor(a.distancePx / DISTANCE_TIE_PX);
  const pb = Math.floor(b.distancePx / DISTANCE_TIE_PX);
  if (pa !== pb) return pa - pb;
  const da = Math.floor(a.depth / DEPTH_TIE);
  const db = Math.floor(b.depth / DEPTH_TIE);
  if (da !== db) return da - db;
  if (a.size !== b.size) return a.size - b.size;
  if (a.distancePx !== b.distancePx) return a.distancePx - b.distancePx;
  return a.control < b.control ? -1 : a.control > b.control ? 1 : 0;
}
