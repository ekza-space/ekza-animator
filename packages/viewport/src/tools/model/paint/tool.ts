// The Paint Colour tool's behaviour (M6A-SPEC §5.19, §6.1 `mesh.paint`, `mesh.paint.fillShell`; B13; lazy chunk):
// - click a face: paints it with the active swatch's slot; drag: paints every face the pointer crosses on the mesh
//   the stroke started on, previewed live and committed on release as one `mesh.paint {faces}` step (source 'tool',
//   so `G` re-activates the tool);
// - Shift+click: fills the face's shell (`mesh.paint.fillShell`);
// - `I` held: the eyedropper — a click makes the slot under the pointer the active swatch (the mesh's palette);
// - `Enter`: applies the active swatch to the selected faces (`mesh.paint` without faces).
// Painting is refused on asset-backed (made-editable) meshes ("Painting imported meshes arrives later") and without an
// active swatch; the reasons are toasted, as the data panels report cancelled runs.
import type { MeshId } from '@ekza-animator/doc';
import {
  activeSwatchOf,
  type EditorApp,
  type MeshOpSession,
  meshKernel,
  PANEL,
  paintRefusal,
  type ToolInstance,
  type ToolKeyEvent,
  type ToolPointerEvent,
} from '@ekza-animator/editor-core';
import { faceAt, type PaintView } from './pick';

export const NO_SWATCH = 'Pick a swatch in the Palette first';

interface Stroke {
  readonly paneId: string;
  readonly mesh: MeshId;
  readonly slot: number;
  readonly faces: number[];
  readonly seen: Set<number>;
  session: MeshOpSession | null;
}

export class PaintTool implements ToolInstance {
  private stroke: Stroke | null = null;
  private eyedropper = false;
  private active = false;

  constructor(
    private readonly app: EditorApp,
    private readonly view: PaintView,
  ) {}

  activate(): void {
    this.active = true;
  }

  deactivate(): void {
    this.active = false;
    this.eyedropper = false;
    this.cancel();
  }

  cursor(): string | null {
    return this.eyedropper ? 'copy' : 'crosshair';
  }

  phase(): 'idle' | 'dragging' {
    return this.stroke === null ? 'idle' : 'dragging';
  }

  key(e: ToolKeyEvent): boolean {
    if (e.code === 'KeyI') {
      if (e.mod || e.alt || e.ctrl) return false;
      this.eyedropper = e.type === 'down';
      return true;
    }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && e.type === 'down' && !e.repeat) {
      if (this.stroke !== null) return true;
      void this.applyToSelection();
      return true;
    }
    return false;
  }

  pointerDown(e: ToolPointerEvent): boolean {
    if (e.button !== 0 || e.alt || e.paneId === null) return false;
    const hit = faceAt(this.app, this.view, e.paneId, e.x, e.y);
    if (hit === null) return false;
    if (this.eyedropper) {
      this.pick(hit.mesh, hit.face);
      return true;
    }
    const swatch = activeSwatchOf(this.app);
    if (swatch === null) return this.refuse(NO_SWATCH);
    const refusal = paintRefusal(this.app, [hit.mesh]);
    if (refusal !== null) return this.refuse(refusal);
    if (e.shift) {
      void this.run('mesh.paint.fillShell', { meshes: [hit.mesh], kind: 'face', slot: swatch.slot, face: hit.face }, e);
      return true;
    }
    this.stroke = {
      paneId: e.paneId,
      mesh: hit.mesh,
      slot: swatch.slot,
      faces: [hit.face],
      seen: new Set([hit.face]),
      session: null,
    };
    this.preview();
    return true;
  }

  pointerMove(e: ToolPointerEvent): boolean {
    const stroke = this.stroke;
    if (stroke === null || e.paneId !== stroke.paneId) return false;
    const hit = faceAt(this.app, this.view, stroke.paneId, e.x, e.y);
    if (hit !== null && hit.mesh === stroke.mesh && !stroke.seen.has(hit.face)) {
      stroke.seen.add(hit.face);
      stroke.faces.push(hit.face);
      this.preview();
    }
    return true;
  }

  pointerUp(e: ToolPointerEvent): boolean {
    const stroke = this.stroke;
    if (stroke === null) return false;
    this.stroke = null;
    void this.run(
      'mesh.paint',
      { meshes: [stroke.mesh], kind: 'face', slot: stroke.slot, faces: [...stroke.faces] },
      e,
    ).then((finished) => {
      // A run that did not finish leaves the preview open: revert it (a finished run committed it).
      if (!finished && stroke.session?.active === true) stroke.session.cancel();
    });
    return true;
  }

  cancel(): void {
    const stroke = this.stroke;
    this.stroke = null;
    if (stroke?.session?.active === true) stroke.session.cancel();
  }

  /** The live preview of the stroke (no document writes; the run commits the matching session). */
  private preview(): void {
    const stroke = this.stroke;
    const op = meshKernel()?.MESH_OPS['mesh.paint'];
    if (stroke === null || op === undefined) return;
    const args = { slot: stroke.slot, faces: [...stroke.faces] };
    try {
      if (stroke.session === null || !stroke.session.active) {
        stroke.session = this.app.meshes.beginOp(op, [stroke.mesh], args);
      } else {
        stroke.session.update(args);
      }
      this.app.requestFrame();
    } catch {
      // No preview (another session is open, the mesh is busy): the release still runs the operator.
      stroke.session = null;
    }
  }

  /** The eyedropper: the slot of the face becomes the active swatch (a swatch of the mesh's palette). */
  private pick(mesh: MeshId, face: number): void {
    const record = this.app.store.get('meshes', mesh);
    const data = this.app.meshes.get(mesh)?.data() ?? null;
    if (record === undefined || data === null) return;
    const layer = data.layers.get('paint');
    const slot = layer === undefined ? 0 : (layer.data[face] as number);
    const palette = record.palette;
    const swatch =
      palette === null
        ? undefined
        : this.app.store.query.swatchesOfPalette(palette).find((candidate) => candidate.slot === slot);
    if (swatch === undefined) {
      this.refuse(`This face's colour (slot ${slot}) is not in the mesh's palette`);
      return;
    }
    void this.app.runUntyped('palette.setActive', { swatch: swatch.id }, { panel: PANEL.viewport }).then((result) => {
      if (result.status === 'cancelled') this.refuse(result.reason);
    });
  }

  private async applyToSelection(): Promise<void> {
    const swatch = activeSwatchOf(this.app);
    if (swatch === null) {
      this.refuse(NO_SWATCH);
      return;
    }
    const hilite = this.app.session.getState().model.hilite;
    const refusal = paintRefusal(this.app, hilite);
    if (refusal !== null) {
      this.refuse(refusal);
      return;
    }
    const result = await this.app.runUntyped(
      'mesh.paint',
      { kind: 'face', slot: swatch.slot },
      { panel: PANEL.viewport, source: 'tool' },
    );
    this.report(result);
  }

  private async run(id: string, args: unknown, e: ToolPointerEvent): Promise<boolean> {
    const result = await this.app.runUntyped(id, args, {
      panel: PANEL.viewport,
      ...(e.paneId === null ? {} : { paneId: e.paneId }),
      source: 'tool',
    });
    this.report(result);
    return result.status === 'finished';
  }

  private report(result: Awaited<ReturnType<EditorApp['runUntyped']>>): void {
    if (result.status === 'failed') this.app.services.notify.toast({ kind: 'error', text: result.error.message });
    else if (result.status === 'cancelled') this.refuse(result.reason);
  }

  private refuse(reason: string): true {
    this.app.services.notify.toast({ kind: 'warning', text: reason });
    return true;
  }

  /** Test probe: whether the eyedropper is held and a stroke is open. */
  state(): { readonly active: boolean; readonly eyedropper: boolean; readonly stroke: readonly number[] | null } {
    return {
      active: this.active,
      eyedropper: this.eyedropper,
      stroke: this.stroke === null ? null : [...this.stroke.faces],
    };
  }
}

export function createPaintTool(app: EditorApp, view: PaintView): PaintTool {
  return new PaintTool(app, view);
}
