// Pointer side of the DOM input adapter: which panel (and viewport pane) is under the pointer, plus the browser
// defaults an animation tool must suppress (research 09 §5.1, §7.1 rule 4).
import { GLOBAL_SCOPE, type KeyScope, PANEL, type PanelKind } from '@ekza-animator/editor-core';

/** Attributes the shell puts on every panel frame. */
export const PANEL_ATTR = 'data-ekza-panel';
export const SCOPE_ATTR = 'data-ekza-scope';
export const INSTANCE_ATTR = 'data-ekza-panel-instance';
/** Optional attribute on viewport pane surfaces (WP-5); the ViewportManager's paneAt() is preferred. */
export const PANE_ATTR = 'data-pane-id';

export interface HoverTarget {
  readonly kind: PanelKind;
  readonly scope: KeyScope;
  /** dockview panel instance id (or the fixed region's id) of the hovered panel. */
  readonly instanceId: string | null;
  readonly paneId: string | null;
}

/**
 * The panel under the pointer: the closest panel frame around `target`; for the viewport also the pane, from
 * `paneAt` (ViewportManager) or the closest `data-pane-id` element.
 */
export function hoverTargetOf(
  target: EventTarget | null,
  clientX: number,
  clientY: number,
  paneAt: ((clientX: number, clientY: number) => string | null) | null,
): HoverTarget | null {
  if (!(target instanceof Element)) return null;
  const frame = target.closest<HTMLElement>(`[${PANEL_ATTR}]`);
  if (frame === null) return null;
  const kind = frame.getAttribute(PANEL_ATTR) ?? '';
  if (kind === '') return null;
  let paneId: string | null = null;
  if (kind === PANEL.viewport) {
    paneId = paneAt?.(clientX, clientY) ?? target.closest(`[${PANE_ATTR}]`)?.getAttribute(PANE_ATTR) ?? null;
  }
  return {
    kind,
    scope: frame.getAttribute(SCOPE_ATTR) ?? kind,
    instanceId: frame.getAttribute(INSTANCE_ATTR),
    paneId,
  };
}

/** Scope chain for a hovered panel: its key scope, then global (ADR 0008 §5). */
export function scopeChainOf(hover: HoverTarget | null): readonly KeyScope[] {
  if (hover === null || hover.scope === GLOBAL_SCOPE) return [GLOBAL_SCOPE];
  return [hover.scope, GLOBAL_SCOPE];
}

export function sameHover(a: HoverTarget | null, b: HoverTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.scope === b.scope && a.instanceId === b.instanceId && a.paneId === b.paneId;
}
