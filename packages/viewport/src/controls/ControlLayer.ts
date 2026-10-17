// Control rendering (ADR 0006 §6, MVP-SPEC §4.11.15): shape polylines per control, transformed by the pose into
// scene space on pose changes, drawn as two batches per character (2 px side colours; 3 px hover/selected/lead), each
// in two passes (occluded at 35 % alpha with `GreaterDepth`, visible at 100 %). The scene-space segments are also
// what picking and the marquee test (ADR 0006 §5).
import type { Mat4 } from '@ekza-animator/anim-core';
import type { CharacterId, ControlId, ControlRecord, Side } from '@ekza-animator/doc';
import { Color, Group } from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LAYER } from '../layers';
import { LineBatch, lineMaterial } from '../overlays/lineBatch';
import { CONTROL_WIDTH, HOVER_LIGHTEN, OCCLUDED_ALPHA, VIEWPORT_THEME } from '../theme';
import { shapeLocalSegments } from './shapes';

export type ControlStyle = 'normal' | 'hover' | 'selected' | 'lead';

/** One drawable, pickable control. `world` holds scene-space segments (xyz pairs) for the current pose. */
export interface ControlEntry {
  readonly id: ControlId;
  readonly character: CharacterId;
  /** Index into the rig program's control slots (`PoseBuffers.controlWorld`). */
  readonly slot: number;
  readonly side: Side;
  /** Shape size in metres: the "smaller control" tie-break of picking. */
  readonly size: number;
  readonly segments: number;
  readonly world: Float32Array;
  visible: boolean;
  style: ControlStyle;
}

interface InternalEntry extends ControlEntry {
  readonly local: Float32Array;
  /** Linear RGB per style: normal, hover, selected, lead. */
  readonly rgb: Float32Array;
}

interface CharacterControls {
  readonly entries: InternalEntry[];
  readonly byId: Map<ControlId, InternalEntry>;
  readonly normal: LineBatch;
  readonly highlight: LineBatch;
  segments: number;
}

const STYLE_INDEX: Readonly<Record<ControlStyle, number>> = { normal: 0, hover: 1, selected: 2, lead: 3 };

/** Owns the control scene: one `Group` holding every character's control batches. */
export class ControlLayer {
  readonly root = new Group();
  /** Bumped whenever scene-space segments, visibility or the control set change (picking caches key on it). */
  version = 0;
  private readonly characters = new Map<CharacterId, CharacterControls>();
  private readonly materials: {
    readonly normalOccluded: LineMaterial;
    readonly normalVisible: LineMaterial;
    readonly highlightOccluded: LineMaterial;
    readonly highlightVisible: LineMaterial;
  };
  private stylesDirty = true;
  private readonly matrix = new Float64Array(16);

  constructor() {
    this.root.name = 'ekza.controls';
    this.root.matrixAutoUpdate = false;
    this.materials = {
      normalOccluded: lineMaterial({ width: CONTROL_WIDTH.normal, opacity: OCCLUDED_ALPHA, occluded: true }),
      normalVisible: lineMaterial({ width: CONTROL_WIDTH.normal }),
      highlightOccluded: lineMaterial({ width: CONTROL_WIDTH.highlight, opacity: OCCLUDED_ALPHA, occluded: true }),
      highlightVisible: lineMaterial({ width: CONTROL_WIDTH.highlight }),
    };
  }

  /** Line materials whose `resolution` must be set to the pane size (CSS px) before drawing a pane. */
  allMaterials(): readonly LineMaterial[] {
    const m = this.materials;
    return [m.normalOccluded, m.normalVisible, m.highlightOccluded, m.highlightVisible];
  }

  /**
   * (Re)builds a character's controls from its records in program slot order. `visible(record)` decides
   * per-user visibility (hidden-by-default secondaries, hidden controls).
   */
  setCharacter(
    character: CharacterId,
    controls: readonly ControlRecord[],
    visible: (c: ControlRecord) => boolean,
  ): void {
    this.removeCharacter(character);
    const m = this.materials;
    const normal = new LineBatch(
      [
        { material: m.normalOccluded, layer: LAYER.controlsOccluded },
        { material: m.normalVisible, layer: LAYER.controlsVisible },
      ],
      `ekza.controls.${character}.normal`,
    );
    const highlight = new LineBatch(
      [
        { material: m.highlightOccluded, layer: LAYER.controlsOccluded },
        { material: m.highlightVisible, layer: LAYER.controlsVisible },
      ],
      `ekza.controls.${character}.highlight`,
    );
    normal.addTo(this.root);
    highlight.addTo(this.root);
    const entries: InternalEntry[] = [];
    let segments = 0;
    controls.forEach((record, slot) => {
      if (record.deleted !== null) return;
      const local = shapeLocalSegments(record.shape);
      const count = local.length / 6;
      segments += count;
      entries.push({
        id: record.id,
        character,
        slot,
        side: record.side,
        size: record.shape.size,
        segments: count,
        local,
        world: new Float32Array(local.length),
        visible: visible(record),
        style: 'normal',
        rgb: styleColors(record),
      });
    });
    this.characters.set(character, {
      entries,
      byId: new Map(entries.map((entry) => [entry.id, entry])),
      normal,
      highlight,
      segments,
    });
    this.stylesDirty = true;
    this.version++;
  }

  removeCharacter(character: CharacterId): void {
    const existing = this.characters.get(character);
    if (existing === undefined) return;
    existing.normal.dispose();
    existing.highlight.dispose();
    this.characters.delete(character);
    this.version++;
  }

  hasCharacter(character: CharacterId): boolean {
    return this.characters.has(character);
  }

  /** Re-evaluates visibility of every control; returns true when anything changed. */
  updateVisibility(visible: (id: ControlId) => boolean): boolean {
    let changed = false;
    for (const set of this.characters.values()) {
      for (const entry of set.entries) {
        const next = visible(entry.id);
        if (next !== entry.visible) {
          entry.visible = next;
          changed = true;
        }
      }
    }
    if (changed) {
      this.stylesDirty = true;
      this.version++;
    }
    return changed;
  }

  /**
   * Places a character's controls for a pose: scene = placement · controlWorld[slot] · local. No allocation.
   * `controlWorld` is `PoseBuffers.controlWorld` (canonical character space, 16 per slot).
   */
  updatePose(character: CharacterId, placement: Mat4, controlWorld: Float64Array): void {
    const set = this.characters.get(character);
    if (set === undefined) return;
    const m = this.matrix;
    for (const entry of set.entries) {
      if (entry.slot * 16 + 16 > controlWorld.length) continue;
      multiplyAt(placement, controlWorld, entry.slot * 16, m);
      transformSegments(m, entry.local, entry.world);
    }
    this.stylesDirty = true;
    this.version++;
  }

  /** Sets hover/selected/lead styles; `selection` is ordered with the lead last. Returns true when anything changed. */
  setStyles(selection: readonly ControlId[], hover: ControlId | null): boolean {
    const selected = new Set(selection);
    const lead = selection.at(-1) ?? null;
    let changed = false;
    for (const set of this.characters.values()) {
      for (const entry of set.entries) {
        const style: ControlStyle =
          entry.id === lead ? 'lead' : selected.has(entry.id) ? 'selected' : entry.id === hover ? 'hover' : 'normal';
        if (style !== entry.style) {
          entry.style = style;
          changed = true;
        }
      }
    }
    if (changed) this.stylesDirty = true;
    return changed;
  }

  /** Rewrites the batches when poses, styles or visibility changed since the last flush. */
  flush(): void {
    if (!this.stylesDirty) return;
    this.stylesDirty = false;
    for (const set of this.characters.values()) {
      set.normal.begin(set.segments);
      set.highlight.begin(set.segments);
      for (const entry of set.entries) {
        if (!entry.visible) continue;
        const batch = entry.style === 'normal' ? set.normal : set.highlight;
        const c = STYLE_INDEX[entry.style] * 3;
        batch.push(
          entry.world,
          0,
          entry.segments,
          entry.rgb[c] as number,
          entry.rgb[c + 1] as number,
          entry.rgb[c + 2] as number,
        );
      }
      set.normal.end();
      set.highlight.end();
    }
  }

  entry(id: ControlId): ControlEntry | undefined {
    for (const set of this.characters.values()) {
      const entry = set.byId.get(id);
      if (entry !== undefined) return entry;
    }
    return undefined;
  }

  /** Every control of every character (visible or not), in character then slot order. */
  *entries(): IterableIterator<ControlEntry> {
    for (const set of this.characters.values()) yield* set.entries;
  }

  dispose(): void {
    for (const character of this.characters.keys()) this.removeCharacter(character);
    for (const material of this.allMaterials()) material.dispose();
  }
}

/** Linear-RGB triplets for normal, hover, selected and lead (ADR 0006 §6 tokens). */
function styleColors(record: ControlRecord): Float32Array {
  const base = new Color(sideColor(record));
  const hover = base.clone();
  const hsl = { h: 0, s: 0, l: 0 };
  hover.getHSL(hsl);
  hover.setHSL(hsl.h, hsl.s, hsl.l + (1 - hsl.l) * HOVER_LIGHTEN);
  const selected = new Color(VIEWPORT_THEME.sel);
  const lead = new Color(VIEWPORT_THEME.selLead);
  return new Float32Array([
    base.r,
    base.g,
    base.b,
    hover.r,
    hover.g,
    hover.b,
    selected.r,
    selected.g,
    selected.b,
    lead.r,
    lead.g,
    lead.b,
  ]);
}

function sideColor(record: ControlRecord): string {
  if (record.shape.color !== 'side') return record.shape.color;
  return record.side === 'L'
    ? VIEWPORT_THEME.rigLeft
    : record.side === 'R'
      ? VIEWPORT_THEME.rigRight
      : VIEWPORT_THEME.rigCenter;
}

/** out = a · b[offset..offset+16] (column-major). */
export function multiplyAt(a: ArrayLike<number>, b: ArrayLike<number>, offset: number, out: Float64Array): void {
  for (let c = 0; c < 4; c++) {
    const b0 = b[offset + c * 4] as number;
    const b1 = b[offset + c * 4 + 1] as number;
    const b2 = b[offset + c * 4 + 2] as number;
    const b3 = b[offset + c * 4 + 3] as number;
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        (a[r] as number) * b0 + (a[4 + r] as number) * b1 + (a[8 + r] as number) * b2 + (a[12 + r] as number) * b3;
    }
  }
}

/** Applies an affine matrix to xyz triplets. */
export function transformSegments(m: ArrayLike<number>, src: Float32Array, out: Float32Array): void {
  const m0 = m[0] as number;
  const m1 = m[1] as number;
  const m2 = m[2] as number;
  const m4 = m[4] as number;
  const m5 = m[5] as number;
  const m6 = m[6] as number;
  const m8 = m[8] as number;
  const m9 = m[9] as number;
  const m10 = m[10] as number;
  const m12 = m[12] as number;
  const m13 = m[13] as number;
  const m14 = m[14] as number;
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i] as number;
    const y = src[i + 1] as number;
    const z = src[i + 2] as number;
    out[i] = m0 * x + m4 * y + m8 * z + m12;
    out[i + 1] = m1 * x + m5 * y + m9 * z + m13;
    out[i + 2] = m2 * x + m6 * y + m10 * z + m14;
  }
}
