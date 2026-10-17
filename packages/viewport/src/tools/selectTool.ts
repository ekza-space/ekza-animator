// The viewport select tool (`Q`; MVP-SPEC §4.11.16): click picks the nearest control (manipulator > control >
// joint), a repeated click within 3 px over the same candidates cycles to the next one, and an LMB drag of ≥ 4 px on
// empty space draws a marquee (crossing test). Modifiers: Shift toggle, Mod remove, Mod+Shift add.
import type { ControlId } from '@ekza-animator/doc';
import {
  type EditorApp,
  PANEL,
  type SelectMode,
  type ToolDef,
  type ToolInstance,
  type ToolPointerEvent,
  VIEWPORT_TOOL,
} from '@ekza-animator/editor-core';
import { PICK } from '../theme';
import type { MarqueeRect } from '../types';
import type { ViewportToolHost } from './host';

/** Selection mode for click and marquee modifiers (research 09 §6.1). */
export function selectModeOf(e: { readonly shift: boolean; readonly mod: boolean }): SelectMode {
  if (e.shift && e.mod) return 'add';
  if (e.shift) return 'toggle';
  if (e.mod) return 'remove';
  return 'replace';
}

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
    readonly index: number;
  } | null = null;

  constructor(
    private readonly app: EditorApp,
    private readonly host: ViewportToolHost,
  ) {}

  get pressed(): boolean {
    return this.press !== null;
  }

  pointerDown(e: ToolPointerEvent): boolean {
    if (e.button !== 0 || e.paneId === null) return false;
    this.press = { paneId: e.paneId, x: e.x, y: e.y, mode: selectModeOf(e), marquee: false };
    return true;
  }

  pointerMove(e: ToolPointerEvent): boolean {
    const press = this.press;
    if (press === null) return false;
    if (!press.marquee && Math.hypot(e.x - press.x, e.y - press.y) >= PICK.marqueeMinPx) press.marquee = true;
    if (press.marquee) this.host.setMarquee(press.paneId, rectOf(press, e));
    return true;
  }

  pointerUp(e: ToolPointerEvent): boolean {
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
    if (this.press?.marquee === true) this.host.setMarquee(this.press.paneId, null);
    this.press = null;
  }

  /** A click: nearest candidate, or the next one when clicking again at the same spot over the same candidates. */
  click(paneId: string, x: number, y: number, mode: SelectMode): void {
    const ids = this.candidateControls(paneId, x, y);
    if (ids.length === 0) {
      this.last = null;
      if (mode === 'replace') this.select([], 'replace', paneId);
      return;
    }
    const key = [...ids].sort().join('|');
    const last = this.last;
    const repeat =
      last !== null &&
      last.paneId === paneId &&
      last.key === key &&
      Math.hypot(x - last.x, y - last.y) <= PICK.cycleRadiusPx;
    const index = repeat ? (last.index + 1) % ids.length : 0;
    this.last = { paneId, x, y, key, index };
    this.select([ids[index] as ControlId], mode, paneId);
  }

  private candidateControls(paneId: string, x: number, y: number): ControlId[] {
    const ids: ControlId[] = [];
    for (const hit of this.host.pickCandidates(paneId, x, y)) {
      let id: ControlId | null = null;
      if (hit.kind === 'control') id = hit.control;
      else if (hit.kind === 'joint') id = this.host.controlForJoint(hit.character, hit.node);
      else if (hit.kind === 'mesh') id = hit.control;
      if (id !== null && !ids.includes(id)) ids.push(id);
    }
    return ids;
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
