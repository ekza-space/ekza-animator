// The Target Weld tool (M6A-SPEC §5.12 "Merge family", §5.14 Target Weld row, §5.10; B12b): press on a vertex (edge
// mode: an edge), drag it onto another one of the same mesh and release: one `mesh.targetWeld {pairs: [[source,
// target]]}` run (`source: 'tool'`) merges the source into the target at the target (the option box's mode) — or at
// their midpoint when dragged with MMB (the trackpad's MMB stand-in included). The kernel welds the mirror pair under
// symmetry (an unpaired one once, with the help line's "No mirror partner: applied to one side"). A rubber band
// follows the pointer and a ring marks the target; `Esc` cancels with no step; RMB is ignored during the drag.
import type { Vec3 } from '@ekza-studio/anim-core';
import type { MeshId } from '@ekza-studio/doc';
import {
  type EditorApp,
  RESERVED_MODAL_KEYS,
  type ToolInstance,
  type ToolKeyEvent,
  type ToolPhase,
  type ToolPointerEvent,
} from '@ekza-studio/editor-core';
import type { ComponentKind } from '@ekza-studio/mesh-core';
import { PREVIEW } from '../topology/overlay';
import type { TopologyRuntime } from '../topology/runtime';

interface Drag {
  readonly mesh: MeshId;
  readonly kind: 'vertex' | 'edge';
  readonly source: number;
  readonly from: Vec3;
  readonly paneId: string;
  readonly button: number;
  target: number | null;
  to: Vec3 | null;
}

export class TargetWeldTool implements ToolInstance {
  private drag: Drag | null = null;

  constructor(
    private readonly app: EditorApp,
    private readonly rt: TopologyRuntime,
  ) {}

  deactivate(): void {
    this.cancel();
  }

  phase(): ToolPhase {
    return this.drag === null ? 'idle' : 'dragging';
  }

  cursor(): string | null {
    return this.drag === null ? 'crosshair' : 'grabbing';
  }

  /** Edges in edge mode (welded end to end), else vertices. */
  private kind(): 'vertex' | 'edge' {
    const mode = this.app.session.getState().model.componentMode;
    return mode === 'edge' ? 'edge' : 'vertex';
  }

  private point(mesh: MeshId, kind: ComponentKind, index: number): Vec3 | null {
    const m = this.rt.readMesh(mesh);
    if (m === null) return null;
    return kind === 'edge' ? this.rt.edgeWorld(mesh, m, index, 0.5) : this.rt.vertexWorld(mesh, m, index);
  }

  pointerDown(e: ToolPointerEvent): boolean {
    if (this.drag !== null) return true;
    if ((e.button !== 0 && e.button !== 1) || e.paneId === null) return false;
    const kind = this.kind();
    const hit = this.rt.pick(e.paneId, e.x, e.y, kind);
    if (hit === null) return false;
    const from = this.point(hit.mesh, kind, hit.index);
    if (from === null) return false;
    this.drag = {
      mesh: hit.mesh,
      kind,
      source: hit.index,
      from,
      paneId: e.paneId,
      button: e.button,
      target: null,
      to: from,
    };
    this.draw();
    return true;
  }

  pointerMove(e: ToolPointerEvent): boolean {
    const drag = this.drag;
    if (drag === null || e.paneId === null) return false;
    const hit = this.rt.pick(e.paneId, e.x, e.y, drag.kind);
    if (hit !== null && hit.mesh === drag.mesh && hit.index !== drag.source) {
      drag.target = hit.index;
      drag.to = this.point(hit.mesh, drag.kind, hit.index);
    } else {
      drag.target = null;
      drag.to = this.free(e.paneId, e.x, e.y, drag.from);
    }
    this.draw();
    return true;
  }

  pointerUp(e: ToolPointerEvent): boolean {
    const drag = this.drag;
    if (drag === null) return false;
    if (e.button !== drag.button) return true;
    this.drag = null;
    this.clear();
    if (drag.target === null) return true;
    void this.app
      .runUntyped(
        'mesh.targetWeld',
        {
          pairs: [[drag.source, drag.target]],
          ...(drag.button === 1 ? { mode: 'center' } : {}),
          meshes: [drag.mesh],
          kind: drag.kind,
        },
        { source: 'tool', paneId: drag.paneId },
      )
      .then((result) => {
        if (result.status === 'finished') this.rt.sayWarnings(result.value);
        else if (result.status === 'cancelled') this.rt.say(result.reason, 'warning');
        else this.rt.say(result.error.message, 'warning');
      });
    return true;
  }

  key(e: ToolKeyEvent): boolean {
    if (this.drag === null) return false;
    if (e.type === 'down' && e.code === 'Escape') {
      this.cancel();
      return true;
    }
    // §5.10: the other reserved modal keys are swallowed during the drag (in object mode `Backspace` would otherwise
    // reach the keymap's `scene.delete`).
    return RESERVED_MODAL_KEYS.has(e.code);
  }

  cancel(): void {
    if (this.drag === null) return;
    this.drag = null;
    this.clear();
  }

  /** The pointer at the source's depth (the rubber band's free end). */
  private free(paneId: string, x: number, y: number, from: Vec3): Vec3 | null {
    const q = this.rt.query(paneId);
    if (q === null) return null;
    const origin = [0, 0, 0];
    const dir = [0, 0, 0];
    q.projector.ray(q.camera, x, y, origin, dir);
    const depth = Math.hypot(
      from[0] - (origin[0] as number),
      from[1] - (origin[1] as number),
      from[2] - (origin[2] as number),
    );
    return [
      (origin[0] as number) + (dir[0] as number) * depth,
      (origin[1] as number) + (dir[1] as number) * depth,
      (origin[2] as number) + (dir[2] as number) * depth,
    ];
  }

  private draw(): void {
    const drag = this.drag;
    if (drag === null) return;
    const points: { at: Vec3; color: readonly [number, number, number] }[] = [{ at: drag.from, color: PREVIEW.rubber }];
    if (drag.target !== null && drag.to !== null) points.push({ at: drag.to, color: PREVIEW.weld });
    this.rt.overlay.set(
      drag.to === null
        ? []
        : [{ positions: [...drag.from, ...drag.to], color: drag.target === null ? PREVIEW.rubber : PREVIEW.weld }],
      points,
    );
    this.rt.invalidate();
  }

  private clear(): void {
    this.rt.overlay.clear();
    this.rt.invalidate();
  }
}
