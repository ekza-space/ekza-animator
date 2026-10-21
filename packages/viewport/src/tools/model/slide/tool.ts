// The Slide Edge tool (M6A-SPEC §5.12 "Slide Edge/Vertex", §5.10, §5.14; Maya's Slide Edge Tool; B12b). With edges
// (edge mode) or vertices (vertex mode) selected, an LMB or MMB drag anywhere in the pane slides them along their
// rails: the first drag direction picks the rail side (the `reference` rail of the selected vertex nearest to the
// press whose screen direction best follows the drag), and the percent is the pointer's travel along that rail's
// screen direction over its screen length (−1…1, clamped). The preview is a `MeshOpSession` of `mesh.slide` (its
// adjust re-solves from the pre-slide positions; no document writes); release commits it with one `mesh.slide` run
// (`source: 'tool'`); `Esc` cancels with no step. A digit during the drag types the percent (§5.10 readout).
import type { ParamDef } from '@ekza-studio/anim-core';
import type { MeshId } from '@ekza-studio/doc';
import {
  type EditorApp,
  meshKernel,
  type MeshOpSession,
  type NumericTarget,
  RESERVED_MODAL_KEYS,
  type ToolInstance,
  type ToolKeyEvent,
  type ToolPhase,
  type ToolPointerEvent,
} from '@ekza-studio/editor-core';
import type { ComponentSelection, EditMesh } from '@ekza-studio/mesh-core';
import { MESH_OP_DESCRIPTORS } from '@ekza-studio/mesh-core/descriptors';
import type { TopologyRuntime } from '../topology/runtime';

const DRAG_PX = 3;
export const NOTHING_TO_SLIDE = 'Select edges or vertices to slide';

const PERCENT: ParamDef | undefined = MESH_OP_DESCRIPTORS['mesh.slide']?.params.find((p) => p.name === 'percent');

interface Press {
  readonly paneId: string;
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly mesh: MeshId;
  readonly kind: 'vertex' | 'edge';
  readonly selection: ComponentSelection;
  /** The reference rail and its screen vector (from the vertex to the rail's far end), once the drag started. */
  reference: { readonly vertex: number; readonly rail: number; readonly dx: number; readonly dy: number } | null;
  session: MeshOpSession | null;
  percent: number;
  typed: boolean;
}

/** The rail of `vertex` whose screen direction best follows (dx, dy), with its screen vector; null when none. */
export function pickRail(
  rails: readonly { readonly rail: number; readonly dx: number; readonly dy: number }[],
  dx: number,
  dy: number,
): { readonly rail: number; readonly dx: number; readonly dy: number } | null {
  const len = Math.hypot(dx, dy);
  let best: { rail: number; dx: number; dy: number; score: number } | null = null;
  for (const r of rails) {
    const l = Math.hypot(r.dx, r.dy);
    if (l < 1e-6 || len < 1e-6) continue;
    const score = (r.dx * dx + r.dy * dy) / (l * len);
    if (best === null || score > best.score) best = { ...r, score };
  }
  return best === null ? null : { rail: best.rail, dx: best.dx, dy: best.dy };
}

/** The slide percent of a pointer travel (dx, dy) along a rail's screen vector, clamped to −1…1. */
export function slidePercent(rail: { readonly dx: number; readonly dy: number }, dx: number, dy: number): number {
  const l2 = rail.dx * rail.dx + rail.dy * rail.dy;
  if (l2 < 1e-9) return 0;
  return Math.max(-1, Math.min(1, (dx * rail.dx + dy * rail.dy) / l2));
}

export class SlideTool implements ToolInstance {
  private press: Press | null = null;

  constructor(
    private readonly app: EditorApp,
    private readonly rt: TopologyRuntime,
  ) {}

  deactivate(): void {
    this.cancel();
  }

  phase(): ToolPhase {
    return this.press === null ? 'idle' : this.press.reference === null ? 'placing' : 'dragging';
  }

  cursor(): string | null {
    return this.press?.reference === null || this.press === null ? 'ew-resize' : 'grabbing';
  }

  /** The hilited mesh and kind with a selection to slide: edges in edge mode, vertices in vertex mode. */
  private target(): {
    readonly mesh: MeshId;
    readonly kind: 'vertex' | 'edge';
    readonly selection: ComponentSelection;
  } | null {
    const model = this.app.session.getState().model;
    const kinds: readonly ('vertex' | 'edge')[] =
      model.componentMode === 'vertex' ? ['vertex'] : model.componentMode === 'edge' ? ['edge'] : ['edge', 'vertex'];
    for (const mesh of model.hilite) {
      for (const kind of kinds) {
        let selection: ComponentSelection;
        try {
          selection = this.app.components.get(mesh, kind);
        } catch {
          continue;
        }
        const set = kind === 'edge' ? selection.edges : selection.verts;
        if (!set.isEmpty()) return { mesh, kind, selection };
      }
    }
    return null;
  }

  pointerDown(e: ToolPointerEvent): boolean {
    if (this.press !== null) return true;
    if ((e.button !== 0 && e.button !== 1) || e.paneId === null) return false;
    const target = this.target();
    if (target === null) {
      this.rt.say(NOTHING_TO_SLIDE, 'warning');
      return false;
    }
    this.press = {
      paneId: e.paneId,
      x: e.x,
      y: e.y,
      button: e.button,
      ...target,
      reference: null,
      session: null,
      percent: 0,
      typed: false,
    };
    return true;
  }

  pointerMove(e: ToolPointerEvent): boolean {
    const press = this.press;
    if (press === null) return false;
    const dx = e.x - press.x;
    const dy = e.y - press.y;
    if (press.reference === null) {
      if (Math.hypot(dx, dy) < DRAG_PX) return true;
      if (!this.start(press, dx, dy)) {
        this.press = null;
        return true;
      }
    }
    if (press.typed || press.reference === null) return true;
    press.percent = slidePercent(press.reference, dx, dy);
    this.update(press);
    return true;
  }

  pointerUp(e: ToolPointerEvent): boolean {
    const press = this.press;
    if (press === null) return false;
    if (e.button !== press.button) return true;
    this.commit();
    return true;
  }

  key(e: ToolKeyEvent): boolean {
    if (this.press === null) return false;
    if (e.type === 'down' && e.code === 'Escape') {
      this.cancel();
      return true;
    }
    if (e.type === 'down' && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
      this.commit();
      return true;
    }
    // §5.10: `Backspace`, `PageUp` and `PageDown` mean nothing to a slide; swallowed, never the keymap's delete.
    return RESERVED_MODAL_KEYS.has(e.code);
  }

  cancel(): void {
    const press = this.press;
    if (press === null) return;
    this.press = null;
    if (press.session?.active === true) press.session.cancel();
    if (this.app.capture.state.armed === 'drag') this.app.capture.disarm();
    this.rt.invalidate();
  }

  numeric(): NumericTarget | null {
    const press = this.press;
    if (press === null || press.reference === null) return null;
    return this.numericTarget();
  }

  /** Picks the reference rail from the first drag direction and opens the preview session. */
  private start(press: Press, dx: number, dy: number): boolean {
    const m = this.rt.readMesh(press.mesh);
    const kernel = meshKernel();
    const op = kernel?.MESH_OPS['mesh.slide'];
    if (m === null || op === undefined) return false;
    const vertex = this.nearestVertex(press, m);
    if (vertex === null) return false;
    const rails = this.rails(press, m, vertex);
    const rail = pickRail(rails, dx, dy);
    if (rail === null) {
      this.rt.say(NOTHING_TO_SLIDE, 'warning');
      return false;
    }
    press.reference = { vertex, ...rail };
    try {
      press.session = this.app.meshes.beginOp(op, [press.mesh], this.args(press), {
        selection: new Map([[press.mesh, press.selection]]),
      });
    } catch {
      press.session = null;
    }
    this.app.capture.arm('drag', this.numericTarget());
    return true;
  }

  private args(press: Press): Record<string, never> {
    const ref = press.reference;
    return {
      percent: press.percent,
      reference: ref === null ? null : { vertex: ref.vertex, rail: ref.rail },
    } as unknown as Record<string, never>;
  }

  private update(press: Press): void {
    if (press.session?.active === true) press.session.update(this.args(press));
    this.rt.invalidate();
  }

  private commit(): void {
    const press = this.press;
    if (press === null) return;
    this.press = null;
    if (this.app.capture.state.armed === 'drag') this.app.capture.disarm();
    if (press.reference === null || press.percent === 0) {
      if (press.session?.active === true) press.session.cancel();
      return;
    }
    void this.app
      .runUntyped(
        'mesh.slide',
        { ...this.args(press), meshes: [press.mesh], kind: press.kind },
        { source: 'tool', paneId: press.paneId },
      )
      .then((result) => {
        if (result.status === 'finished') this.rt.sayWarnings(result.value);
        else {
          if (press.session?.active === true) press.session.cancel();
          this.rt.say(result.status === 'cancelled' ? result.reason : result.error.message, 'warning');
        }
      });
  }

  /** The selected vertex nearest to the press on screen. */
  private nearestVertex(press: Press, m: EditMesh): number | null {
    const verts = new Set<number>();
    if (press.kind === 'vertex') press.selection.verts.forEach((v) => verts.add(v));
    else {
      press.selection.edges.forEach((e) => {
        if (e >= m.counts.edges) return;
        verts.add(m.edgeVert(e, 0));
        verts.add(m.edgeVert(e, 1));
      });
    }
    let best: { v: number; d: number } | null = null;
    for (const v of verts) {
      if (v >= m.counts.points) continue;
      const p = this.rt.project(press.paneId, this.rt.vertexWorld(press.mesh, m, v));
      if (p === null) continue;
      const d = Math.hypot(p.x - press.x, p.y - press.y);
      if (best === null || d < best.d) best = { v, d };
    }
    return best?.v ?? null;
  }

  /** A vertex's rails with their screen vectors: its unselected edges (edge mode) or all its edges (vertex mode). */
  private rails(press: Press, m: EditMesh, v: number): { rail: number; dx: number; dy: number }[] {
    const out: { rail: number; dx: number; dy: number }[] = [];
    const from = this.rt.project(press.paneId, this.rt.vertexWorld(press.mesh, m, v));
    const first = m.vertEdge(v);
    if (from === null || first < 0) return out;
    let e = first;
    do {
      if (!(press.kind === 'edge' && press.selection.edges.has(e))) {
        const far = m.edgeOther(e, v);
        const to = this.rt.project(press.paneId, this.rt.vertexWorld(press.mesh, m, far));
        if (to !== null) out.push({ rail: e, dx: to.x - from.x, dy: to.y - from.y });
      }
      e = m.edgeDiskNext(e, v);
    } while (e !== first && e >= 0);
    return out;
  }

  private numericTarget(): NumericTarget {
    return {
      fields: PERCENT === undefined ? [] : [PERCENT],
      active: 'percent',
      value: () => this.press?.percent ?? 0,
      set: (_name, value) => {
        const press = this.press;
        if (press === null) return;
        press.percent = Math.max(-1, Math.min(1, value));
        press.typed = true;
        this.update(press);
      },
      confirm: () => this.commit(),
      cancel: () => this.cancel(),
    };
  }
}
