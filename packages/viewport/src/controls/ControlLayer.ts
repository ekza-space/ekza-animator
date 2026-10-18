// Control rendering (ADR 0006 §6, MVP-SPEC §4.11.15): shape polylines per control, transformed by the pose into
// scene space on pose changes, drawn as two batches per character (2 px side colours; 3 px hover/selected/lead), each
// in two passes (occluded at 35 % alpha with `GreaterDepth`, visible at 100 %). The scene-space segments are also
// what picking and the marquee test (ADR 0006 §5).
//
// M2a (M2A-SPEC §5.5, A2): a control is 'visible', 'ghost' or 'hidden' (`controlVisibility`). Ghosts (a selected
// control the IK/FK rule hides) draw in a third batch at 25 % alpha and are never pickable; poles draw a dashed
// annotation line from the limb's mid bone to the pole control (`--rig-pole-line`, 1 px, 60 % alpha) in both passes.
import type { Mat4 } from '@ekza-animator/anim-core';
import type { CharacterId, ControlId, ControlRecord, Side } from '@ekza-animator/doc';
import type { ControlVisibility } from '@ekza-animator/editor-core';
import { Color, Group } from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LAYER } from '../layers';
import { LineBatch, lineMaterial } from '../overlays/lineBatch';
import { CONTROL_WIDTH, GHOST_ALPHA, HOVER_LIGHTEN, OCCLUDED_ALPHA, POLE_LINE, VIEWPORT_THEME } from '../theme';
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
  /** Drawn normally and pickable (§5.5 'visible'). */
  visible: boolean;
  /** Drawn at 25 % alpha, never pickable (§5.5 'ghost'). */
  ghost: boolean;
  style: ControlStyle;
}

/** A pole annotation (§5.5 rule 4): the pole control and the limb's mid bone node. */
export interface PoleLink {
  readonly pole: ControlId;
  readonly midNode: number;
}

/** World-space dash period of the pole line (metres); dashes are half of it, 4…64 per line. */
const POLE_DASH_PERIOD = 0.03;
const POLE_MAX_DASHES = 64;

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
  readonly ghost: LineBatch;
  readonly poleLines: LineBatch;
  /** Pole links with their scene-space end points (mid bone, pole) for the current pose: 6 floats each. */
  poles: readonly PoleLink[];
  poleEnds: Float32Array;
  segments: number;
}

/** A `setCharacter`/`updateVisibility` answer: a §5.5 visibility, or the M1 boolean (true = visible). */
export type VisibilityAnswer = ControlVisibility | boolean;

const asVisibility = (answer: VisibilityAnswer): ControlVisibility =>
  answer === true ? 'visible' : answer === false ? 'hidden' : answer;

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
    readonly ghostOccluded: LineMaterial;
    readonly ghostVisible: LineMaterial;
    readonly poleOccluded: LineMaterial;
    readonly poleVisible: LineMaterial;
  };
  private stylesDirty = true;
  private readonly matrix = new Float64Array(16);
  private readonly dash = new Float32Array(6);

  constructor() {
    this.root.name = 'ekza.controls';
    this.root.matrixAutoUpdate = false;
    this.materials = {
      normalOccluded: lineMaterial({ width: CONTROL_WIDTH.normal, opacity: OCCLUDED_ALPHA, occluded: true }),
      normalVisible: lineMaterial({ width: CONTROL_WIDTH.normal }),
      highlightOccluded: lineMaterial({ width: CONTROL_WIDTH.highlight, opacity: OCCLUDED_ALPHA, occluded: true }),
      highlightVisible: lineMaterial({ width: CONTROL_WIDTH.highlight }),
      ghostOccluded: lineMaterial({
        width: CONTROL_WIDTH.highlight,
        opacity: GHOST_ALPHA * OCCLUDED_ALPHA,
        occluded: true,
      }),
      ghostVisible: lineMaterial({ width: CONTROL_WIDTH.highlight, opacity: GHOST_ALPHA }),
      poleOccluded: lineMaterial({
        width: POLE_LINE.width,
        opacity: POLE_LINE.alpha * OCCLUDED_ALPHA,
        occluded: true,
        vertexColors: false,
        color: POLE_LINE.color,
      }),
      poleVisible: lineMaterial({
        width: POLE_LINE.width,
        opacity: POLE_LINE.alpha,
        vertexColors: false,
        color: POLE_LINE.color,
      }),
    };
  }

  /** Line materials whose `resolution` must be set to the pane size (CSS px) before drawing a pane. */
  allMaterials(): readonly LineMaterial[] {
    const m = this.materials;
    return [
      m.normalOccluded,
      m.normalVisible,
      m.highlightOccluded,
      m.highlightVisible,
      m.ghostOccluded,
      m.ghostVisible,
      m.poleOccluded,
      m.poleVisible,
    ];
  }

  /**
   * (Re)builds a character's controls from its records in program slot order. `visible(record)` decides the
   * per-user visibility (§5.5: 'visible', 'ghost', 'hidden'; the M1 boolean is accepted). `poles` are the limbs'
   * pole annotations (none by default).
   */
  setCharacter(
    character: CharacterId,
    controls: readonly ControlRecord[],
    visible: (c: ControlRecord) => VisibilityAnswer,
    poles: readonly PoleLink[] = [],
  ): void {
    this.removeCharacter(character);
    const m = this.materials;
    const batch = (occluded: LineMaterial, visibleMaterial: LineMaterial, name: string): LineBatch =>
      new LineBatch(
        [
          { material: occluded, layer: LAYER.controlsOccluded },
          { material: visibleMaterial, layer: LAYER.controlsVisible },
        ],
        `ekza.controls.${character}.${name}`,
      );
    const normal = batch(m.normalOccluded, m.normalVisible, 'normal');
    const highlight = batch(m.highlightOccluded, m.highlightVisible, 'highlight');
    const ghost = batch(m.ghostOccluded, m.ghostVisible, 'ghost');
    const poleLines = batch(m.poleOccluded, m.poleVisible, 'poles');
    for (const b of [normal, highlight, ghost, poleLines]) b.addTo(this.root);
    const entries: InternalEntry[] = [];
    let segments = 0;
    controls.forEach((record, slot) => {
      if (record.deleted !== null) return;
      const local = shapeLocalSegments(record.shape);
      const count = local.length / 6;
      segments += count;
      const visibility = asVisibility(visible(record));
      entries.push({
        id: record.id,
        character,
        slot,
        side: record.side,
        size: record.shape.size,
        segments: count,
        local,
        world: new Float32Array(local.length),
        visible: visibility === 'visible',
        ghost: visibility === 'ghost',
        style: 'normal',
        rgb: styleColors(record),
      });
    });
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const links = poles.filter((link) => byId.has(link.pole) && link.midNode >= 0);
    this.characters.set(character, {
      entries,
      byId,
      normal,
      highlight,
      ghost,
      poleLines,
      poles: links,
      poleEnds: new Float32Array(links.length * 6).fill(Number.NaN),
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
    existing.ghost.dispose();
    existing.poleLines.dispose();
    this.characters.delete(character);
    this.version++;
  }

  hasCharacter(character: CharacterId): boolean {
    return this.characters.has(character);
  }

  /**
   * Re-evaluates the visibility of every control (§5.5: 'visible', 'ghost', 'hidden'; the M1 boolean is accepted);
   * returns true when anything changed. Only a change of pickable controls bumps `version` (picking caches).
   */
  updateVisibility(visible: (id: ControlId) => VisibilityAnswer): boolean {
    let changed = false;
    let pickable = false;
    for (const set of this.characters.values()) {
      for (const entry of set.entries) {
        const next = asVisibility(visible(entry.id));
        const isVisible = next === 'visible';
        const isGhost = next === 'ghost';
        if (isVisible !== entry.visible) pickable = true;
        if (isVisible !== entry.visible || isGhost !== entry.ghost) {
          entry.visible = isVisible;
          entry.ghost = isGhost;
          changed = true;
        }
      }
    }
    if (changed) this.stylesDirty = true;
    if (pickable) this.version++;
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

  /**
   * Places a character's pole annotations for a pose (§5.5 rule 4): from the mid bone's world position
   * (`PoseBuffers.boneWorld`) to the pole control's world position, both in scene space. No allocation.
   */
  updatePoles(character: CharacterId, placement: Mat4, boneWorld: Float64Array, controlWorld: Float64Array): void {
    const set = this.characters.get(character);
    if (set === undefined || set.poles.length === 0) return;
    const m = this.matrix;
    set.poles.forEach((link, i) => {
      const entry = set.byId.get(link.pole);
      const o = i * 6;
      if (
        entry === undefined ||
        link.midNode * 16 + 16 > boneWorld.length ||
        entry.slot * 16 + 16 > controlWorld.length
      ) {
        set.poleEnds.fill(Number.NaN, o, o + 6);
        return;
      }
      multiplyAt(placement, boneWorld, link.midNode * 16, m);
      set.poleEnds[o] = m[12] as number;
      set.poleEnds[o + 1] = m[13] as number;
      set.poleEnds[o + 2] = m[14] as number;
      multiplyAt(placement, controlWorld, entry.slot * 16, m);
      set.poleEnds[o + 3] = m[12] as number;
      set.poleEnds[o + 4] = m[13] as number;
      set.poleEnds[o + 5] = m[14] as number;
    });
    this.stylesDirty = true;
  }

  /** Scene-space end points (mid bone, pole) of a character's drawn pole lines (tests, probes). */
  poleLines(
    character: CharacterId,
  ): readonly { readonly pole: ControlId; readonly from: readonly number[]; readonly to: readonly number[] }[] {
    const set = this.characters.get(character);
    if (set === undefined) return [];
    const out: { pole: ControlId; from: number[]; to: number[] }[] = [];
    set.poles.forEach((link, i) => {
      const entry = set.byId.get(link.pole);
      const e = set.poleEnds;
      if (entry === undefined || !entry.visible || Number.isNaN(e[i * 6])) return;
      out.push({
        pole: link.pole,
        from: [e[i * 6] as number, e[i * 6 + 1] as number, e[i * 6 + 2] as number],
        to: [e[i * 6 + 3] as number, e[i * 6 + 4] as number, e[i * 6 + 5] as number],
      });
    });
    return out;
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
      set.ghost.begin(set.segments);
      for (const entry of set.entries) {
        if (!entry.visible && !entry.ghost) continue;
        const batch = entry.ghost ? set.ghost : entry.style === 'normal' ? set.normal : set.highlight;
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
      set.ghost.end();
      this.writePoleLines(set);
    }
  }

  /** Dashed pole lines of the visible poles (world-space dashes: half of each period drawn). */
  private writePoleLines(set: CharacterControls): void {
    set.poleLines.begin(set.poles.length * POLE_MAX_DASHES);
    const e = set.poleEnds;
    const dash = this.dash;
    set.poles.forEach((link, i) => {
      if (set.byId.get(link.pole)?.visible !== true) return;
      const o = i * 6;
      const x0 = e[o] as number;
      if (Number.isNaN(x0)) return;
      const y0 = e[o + 1] as number;
      const z0 = e[o + 2] as number;
      const dx = (e[o + 3] as number) - x0;
      const dy = (e[o + 4] as number) - y0;
      const dz = (e[o + 5] as number) - z0;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(length > 1e-6)) return;
      const n = Math.min(POLE_MAX_DASHES, Math.max(4, Math.round(length / POLE_DASH_PERIOD)));
      for (let k = 0; k < n; k++) {
        const a = k / n;
        const b = (k + 0.5) / n;
        dash[0] = x0 + dx * a;
        dash[1] = y0 + dy * a;
        dash[2] = z0 + dz * a;
        dash[3] = x0 + dx * b;
        dash[4] = y0 + dy * b;
        dash[5] = z0 + dz * b;
        set.poleLines.push(dash, 0, 1, 1, 1, 1);
      }
    });
    set.poleLines.end();
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
