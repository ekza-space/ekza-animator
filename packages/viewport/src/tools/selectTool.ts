// The viewport select tool (`Q`; MVP-SPEC §4.11.16): click picks the nearest control (manipulator > control >
// joint), a repeated click within 3 px over the same candidates cycles to the next one, and an LMB drag of ≥ 4 px on
// empty space draws a marquee (crossing test). Modifiers: Shift toggle, Mod remove, Mod+Shift add.
// M6a (B10, §5.6): in the Model workspace the same presses select components of the hilited meshes (component modes)
// or mesh objects (object mode) through the Model select runtime (`./model/select`); the move, rotate and scale tools
// share this behaviour for presses that miss their manipulator.
import type { CharacterId, ControlId } from '@ekza-studio/doc';
import {
  type EditorApp,
  limbOfControlApp,
  PANEL,
  type SelectMode,
  type ToolDef,
  type ToolInstance,
  type ToolPointerEvent,
  VIEWPORT_TOOL,
} from '@ekza-studio/editor-core';
import { PICK } from '../theme';
import type { MarqueeRect } from '../types';
import type { ViewportToolHost } from './host';
import { modelSelectOf } from './model/select';
import type { ModelSelectBehaviour, ModelSelectRuntime } from './model/select/runtime';

/** Selection mode for click and marquee modifiers (research 09 §6.1). */
export function selectModeOf(e: { readonly shift: boolean; readonly mod: boolean }): SelectMode {
  if (e.shift && e.mod) return 'add';
  if (e.shift) return 'toggle';
  if (e.mod) return 'remove';
  return 'replace';
}

/**
 * M2A-SPEC §1.2 fallback of the M2a-stretch mesh-pick → IK control mapping: a mesh click on a limb that is in IK
 * (`ikFk > 0.5`) still selects the FK control the bone maps to, and says how to reach the IK control.
 */
export const MESH_PICK_IK_HINT = 'IK limb: pick the IK control';

interface Press {
  readonly paneId: string;
  readonly x: number;
  readonly y: number;
  readonly mode: SelectMode;
  marquee: boolean;
}

/**
 * Click / marquee / cycling behaviour shared by the select, move and rotate tools (the transform tools fall back to
 * it when the press misses the manipulator).
 */
export class SelectBehaviour {
  private press: Press | null = null;
  private last: {
    readonly paneId: string;
    readonly x: number;
    readonly y: number;
    readonly key: string;
    /** Candidates in the order of the cycle's first click. */
    readonly order: readonly ControlId[];
    readonly index: number;
  } | null = null;

  /** M6a: the Model behaviour of the runtime it was made for, and whether it owns the current press. */
  private model: { readonly runtime: ModelSelectRuntime; readonly behaviour: ModelSelectBehaviour } | null = null;
  private modelPress = false;

  constructor(
    private readonly app: EditorApp,
    private readonly host: ViewportToolHost,
  ) {}

  get pressed(): boolean {
    return this.press !== null || this.modelPress;
  }

  /** The Model behaviour while the Model workspace is active and its runtime has loaded, else null. */
  private modelBehaviour(): ModelSelectBehaviour | null {
    if (this.app.session.getState().workspace !== 'model') return null;
    const runtime = modelSelectOf(this.app);
    if (runtime === null) return null;
    if (this.model?.runtime !== runtime) this.model = { runtime, behaviour: runtime.behaviour(this.host) };
    return this.model.behaviour;
  }

  /** A press that completes a Model double-click (§5.6 loop table): the transform tools give it to selection. */
  completesDouble(e: ToolPointerEvent): boolean {
    return this.modelBehaviour()?.completesDouble(e) ?? false;
  }

  pointerDown(e: ToolPointerEvent): boolean {
    if (e.button !== 0 || e.paneId === null) return false;
    const model = this.modelBehaviour();
    if (model !== null) {
      this.modelPress = model.pointerDown(e);
      return this.modelPress;
    }
    this.press = { paneId: e.paneId, x: e.x, y: e.y, mode: selectModeOf(e), marquee: false };
    return true;
  }

  pointerMove(e: ToolPointerEvent): boolean {
    if (this.modelPress) return this.model?.behaviour.pointerMove(e) ?? false;
    const press = this.press;
    if (press === null) return false;
    if (!press.marquee && Math.hypot(e.x - press.x, e.y - press.y) >= PICK.marqueeMinPx) press.marquee = true;
    if (press.marquee) this.host.setMarquee(press.paneId, rectOf(press, e));
    return true;
  }

  pointerUp(e: ToolPointerEvent): boolean {
    if (this.modelPress) {
      this.modelPress = false;
      return this.model?.behaviour.pointerUp(e) ?? false;
    }
    const press = this.press;
    if (press === null) return false;
    this.press = null;
    if (press.marquee) {
      const rect = rectOf(press, e);
      this.host.setMarquee(press.paneId, null);
      this.last = null;
      const ids = this.host.marquee(press.paneId, rect);
      if (ids.length > 0 || press.mode === 'replace') this.select(ids, press.mode, press.paneId);
      return true;
    }
    this.click(press.paneId, press.x, press.y, press.mode);
    return true;
  }

  cancel(): void {
    if (this.modelPress) {
      this.modelPress = false;
      this.model?.behaviour.cancel();
    }
    if (this.press?.marquee === true) this.host.setMarquee(this.press.paneId, null);
    this.press = null;
  }

  /**
   * A click: the nearest candidate, or — for a plain click again at the same spot over the same candidates — the next
   * one, in the order of the cycle's first click. Modifier clicks (toggle, add, remove) act on the nearest candidate
   * and never cycle, so a second Shift+click toggles the same control back (acceptance round 2).
   */
  click(paneId: string, x: number, y: number, mode: SelectMode): void {
    const meshPicks = new Map<ControlId, CharacterId>();
    const ids = this.candidateControls(paneId, x, y, meshPicks);
    if (ids.length === 0) {
      this.last = null;
      if (mode === 'replace') this.select([], 'replace', paneId);
      return;
    }
    if (mode !== 'replace') {
      this.last = null;
      this.select([ids[0] as ControlId], mode, paneId);
      this.hintMeshPick(ids[0] as ControlId, meshPicks);
      return;
    }
    const key = [...ids].sort().join('|');
    const last = this.last;
    const repeat =
      last !== null &&
      last.paneId === paneId &&
      last.key === key &&
      Math.hypot(x - last.x, y - last.y) <= PICK.cycleRadiusPx;
    const order = repeat ? last.order : ids;
    const index = repeat ? (last.index + 1) % order.length : 0;
    this.last = { paneId, x, y, key, order, index };
    this.select([order[index] as ControlId], mode, paneId);
    this.hintMeshPick(order[index] as ControlId, meshPicks);
  }

  /** Candidate controls in pick order; `meshPicks` gets the controls only a mesh hit named, with its character. */
  private candidateControls(paneId: string, x: number, y: number, meshPicks: Map<ControlId, CharacterId>): ControlId[] {
    const ids: ControlId[] = [];
    for (const hit of this.host.pickCandidates(paneId, x, y)) {
      let id: ControlId | null = null;
      if (hit.kind === 'control') id = hit.control;
      else if (hit.kind === 'joint') id = this.host.controlForJoint(hit.character, hit.node);
      else if (hit.kind === 'mesh') id = hit.control;
      if (id === null || ids.includes(id)) continue;
      ids.push(id);
      if (hit.kind === 'mesh') meshPicks.set(id, hit.character);
    }
    return ids;
  }

  /** The §1.2 hint when the selected control came from a mesh hit on an FK control of a limb in IK. */
  private hintMeshPick(id: ControlId, meshPicks: ReadonlyMap<ControlId, CharacterId>): void {
    const character = meshPicks.get(id);
    if (character === undefined) return;
    const limb = limbOfControlApp(this.app, id);
    if (limb === null || !limb.fkControls.includes(id)) return;
    if ((this.app.evaluation.ikFk(character, limb.id) ?? 0) <= 0.5) return;
    this.app.services.notify.toast({ kind: 'info', text: MESH_PICK_IK_HINT });
  }

  private select(ids: readonly ControlId[], mode: SelectMode, paneId: string): void {
    void this.app.run('select.controls', { ids, mode }, { panel: PANEL.viewport, paneId });
  }
}

function rectOf(press: Press, e: ToolPointerEvent): MarqueeRect {
  return { x0: press.x, y0: press.y, x1: e.x, y1: e.y };
}

export function selectToolDef(): ToolDef<ViewportToolHost> {
  return {
    id: VIEWPORT_TOOL.select,
    panel: PANEL.viewport,
    label: 'Select',
    icon: 'tool-select',
    create(app: EditorApp, host: ViewportToolHost): ToolInstance {
      const behaviour = new SelectBehaviour(app, host);
      return {
        pointerDown: (e) => behaviour.pointerDown(e),
        pointerMove: (e) => behaviour.pointerMove(e),
        pointerUp: (e) => behaviour.pointerUp(e),
        cancel: () => behaviour.cancel(),
        deactivate: () => behaviour.cancel(),
        cursor: () => null,
      };
    },
  };
}
