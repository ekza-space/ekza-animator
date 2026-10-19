// The Insert Edge Loop tool (M6A-SPEC §5.11 "Insert Edge Loop", §5.10, §5.14; B12b): hovering an edge previews the
// whole loop (and its mirror image under symmetry) exactly as the kernel would place it — a scratch run of
// `mesh.insertLoop` with the option box's mode and loop count; pressing on the edge starts it and dragging slides it
// along the edge before release ("slide before release", the weight is the pointer ray's closest approach to the
// seed edge); release places it with one `mesh.insertLoop` run (`source: 'tool'`, so `G` re-activates this tool,
// §5.7). `Esc` cancels with no step; RMB is ignored while sliding; a digit during the slide types the weight and
// `PageUp`/`PageDown` step the loop count of Multiple mode (§5.10).
import type { ParamDef } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import {
  type EditorApp,
  type NumericTarget,
  type ToolInstance,
  type ToolKeyEvent,
  type ToolPhase,
  type ToolPointerEvent,
} from '@ekza-animator/editor-core';
import { MESH_OP_DESCRIPTORS } from '@ekza-animator/mesh-core/descriptors';
import { PREVIEW } from '../topology/overlay';
import { isRefusal, type PanePoint, type TopologyRuntime } from '../topology/runtime';

/** Pointer travel (CSS px) before a press becomes a slide (§5.10). */
const DRAG_PX = 3;

interface Seed {
  readonly mesh: MeshId;
  readonly edge: number;
  readonly paneId: string;
  readonly x: number;
  readonly y: number;
  weight: number;
  /** `PageUp`/`PageDown` during the gesture step the loop count (§5.10; the option box's mode Multiple uses it). */
  divisions: number | null;
  moved: boolean;
  /** A typed weight (the capture window's entry) replaces the pointer's. */
  typed: boolean;
}

const WEIGHT: ParamDef | undefined = MESH_OP_DESCRIPTORS['mesh.insertLoop']?.params.find((p) => p.name === 'weight');

export class InsertLoopTool implements ToolInstance {
  private seed: Seed | null = null;

  constructor(
    private readonly app: EditorApp,
    private readonly rt: TopologyRuntime,
  ) {}

  activate(): void {
    this.rt.onHover((at) => this.hovered(at));
    this.hovered(this.rt.hovered);
  }

  deactivate(): void {
    this.cancel();
    this.rt.onHover(null);
    this.rt.overlay.clear();
    this.rt.invalidate();
  }

  phase(): ToolPhase {
    return this.seed === null ? 'idle' : this.seed.moved ? 'dragging' : 'placing';
  }

  cursor(): string | null {
    return 'crosshair';
  }

  pointerDown(e: ToolPointerEvent): boolean {
    if (this.seed !== null) return true; // RMB and other buttons are ignored while sliding
    if (e.button !== 0 || e.paneId === null) return false;
    const hit = this.rt.pick(e.paneId, e.x, e.y, 'edge');
    if (hit === null) return false;
    this.seed = {
      mesh: hit.mesh,
      edge: hit.index,
      paneId: e.paneId,
      x: e.x,
      y: e.y,
      weight: hit.t ?? 0.5,
      divisions: null,
      moved: false,
      typed: false,
    };
    this.app.capture.arm('drag', this.numericTarget());
    this.preview();
    return true;
  }

  pointerMove(e: ToolPointerEvent): boolean {
    const seed = this.seed;
    if (seed === null) return false;
    if (!seed.moved && Math.hypot(e.x - seed.x, e.y - seed.y) < DRAG_PX) return true;
    seed.moved = true;
    if (seed.typed) return true;
    const m = this.rt.readMesh(seed.mesh);
    const t = m === null ? null : this.rt.edgeParamAt(seed.paneId, seed.mesh, m, seed.edge, e.x, e.y);
    if (t !== null) {
      seed.weight = t;
      this.preview();
    }
    return true;
  }

  pointerUp(e: ToolPointerEvent): boolean {
    const seed = this.seed;
    if (seed === null) return false;
    if (e.button !== 0) return true;
    this.place();
    return true;
  }

  key(e: ToolKeyEvent): boolean {
    if (e.type !== 'down' || this.seed === null) return false;
    if (e.code === 'Escape') {
      this.cancel();
      return true;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      this.place();
      return true;
    }
    if (e.code === 'PageUp' || e.code === 'PageDown') {
      const seed = this.seed;
      const defaults = this.app.prefs.getState().modeling.optionDefaults['mesh.insertLoop'] ?? {};
      const current = seed.divisions ?? (typeof defaults['divisions'] === 'number' ? defaults['divisions'] : 2);
      seed.divisions = Math.max(1, Math.min(16, current + (e.code === 'PageUp' ? 1 : -1)));
      this.preview();
      return true;
    }
    return false;
  }

  cancel(): void {
    if (this.seed === null) return;
    this.seed = null;
    if (this.app.capture.state.armed === 'drag') this.app.capture.disarm();
    this.hovered(this.rt.hovered);
  }

  numeric(): NumericTarget | null {
    return this.seed === null ? null : this.numericTarget();
  }

  // ---------- run and preview ----------

  /** The args a run with this seed gets (the runner adds the option box's mode and count under them). */
  private args(seed: Seed): Record<string, unknown> {
    return {
      seedEdge: seed.edge,
      weight: seed.weight,
      ...(seed.divisions === null ? {} : { divisions: seed.divisions }),
      meshes: [seed.mesh],
      kind: 'edge',
    };
  }

  private place(): void {
    const seed = this.seed;
    if (seed === null) return;
    this.seed = null;
    if (this.app.capture.state.armed === 'drag') this.app.capture.disarm();
    this.rt.overlay.clear();
    this.rt.invalidate();
    void this.app
      .runUntyped('mesh.insertLoop', this.args(seed), { source: 'tool', paneId: seed.paneId })
      .then((result) => {
        if (result.status === 'finished') this.rt.sayWarnings(result.value);
        else if (result.status === 'cancelled') this.rt.say(result.reason, 'warning');
        this.hovered(this.rt.hovered);
      });
  }

  private hovered(at: PanePoint | null): void {
    if (this.seed !== null) return;
    const hit = at === null ? null : this.rt.pick(at.paneId, at.x, at.y, 'edge');
    if (hit === null) {
      this.rt.overlay.clear();
      this.rt.invalidate();
      return;
    }
    this.draw(hit.mesh, hit.index, hit.t ?? 0.5);
  }

  private preview(): void {
    const seed = this.seed;
    if (seed !== null) this.draw(seed.mesh, seed.edge, seed.weight, seed.divisions);
  }

  /** Draws the loops a run would insert (the option box's mode and count; the mirror image under symmetry). */
  private draw(mesh: MeshId, edge: number, weight: number, divisions: number | null = null): void {
    const defaults = this.app.prefs.getState().modeling.optionDefaults['mesh.insertLoop'] ?? {};
    const args = { ...defaults, seedEdge: edge, weight, ...(divisions === null ? {} : { divisions }) };
    const segments =
      this.rt.tryOp(mesh, 'mesh.insertLoop', args, null, (m, result) =>
        isRefusal(result) ? [] : this.rt.edgeSegments(mesh, m, result.selection.edges.toArray()),
      ) ?? [];
    this.rt.overlay.set(segments.length > 0 ? [{ positions: segments, color: PREVIEW.loop }] : []);
    this.rt.invalidate();
  }

  private numericTarget(): NumericTarget {
    return {
      fields: WEIGHT === undefined ? [] : [WEIGHT],
      active: 'weight',
      value: () => this.seed?.weight ?? 0,
      set: (_name, value) => {
        const seed = this.seed;
        if (seed === null) return;
        seed.weight = Math.max(0, Math.min(1, value));
        seed.typed = true;
        this.preview();
      },
      confirm: () => this.place(),
      cancel: () => this.cancel(),
    };
  }
}
