// Contributions of the time slider (MVP-SPEC §4.9 owner 6t, ADR 0008): the `time.selectBand` operator and the
// built-in items of the slider's RMB menu ('timeline.context', §4.11.17).
import type { Disposer, Frame, TangentType } from '@ekza-studio/anim-core';
import {
  type CountResult,
  type EditorApp,
  type MenuItemDef,
  type OperatorDef,
  PANEL,
  type PollResult,
  type SelectMode,
} from '@ekza-studio/editor-core';
import { activeTimelineContext } from './context';
import { applyBandSelection } from './keys';

/** Menu id of the time slider's context menu. */
export const TIMELINE_CONTEXT_MENU = 'timeline.context';

export interface SelectBandArgs {
  readonly band: { readonly start: Frame; readonly end: Frame } | null;
  readonly mode?: SelectMode;
}

const SELECT_MODES: readonly SelectMode[] = ['replace', 'toggle', 'add', 'remove'];

function validBand(band: unknown): boolean {
  if (band === null) return true;
  if (typeof band !== 'object' || band === undefined) return false;
  const { start, end } = band as { readonly start?: unknown; readonly end?: unknown };
  return typeof start === 'number' && typeof end === 'number' && Number.isFinite(start) && Number.isFinite(end);
}

/** The time slider whose band changed draws at once instead of on its next scheduled frame. */
export type FocusedSlider = () => { redraw(force?: boolean): void } | null;

export function selectBandOperator(focused: FocusedSlider): OperatorDef<SelectBandArgs, CountResult> {
  return {
    id: 'time.selectBand',
    label: 'Select Time Range',
    description: 'Selects a frame range on the time slider together with the keys of the target controls inside it.',
    category: 'time',
    scope: PANEL.timeline,
    poll(ctx, args): PollResult {
      const value = args as Partial<SelectBandArgs> | undefined;
      if (value === undefined || !('band' in value) || !validBand(value.band)) {
        return { ok: false, reason: 'expects { band: { start, end } | null }' };
      }
      if (value.mode !== undefined && !SELECT_MODES.includes(value.mode)) {
        return { ok: false, reason: `unknown selection mode '${String(value.mode)}'` };
      }
      if (value.band !== null && activeTimelineContext(ctx.app) === null)
        return { ok: false, reason: 'no active clip' };
      return true;
    },
    apply(ctx, args): CountResult {
      const count = applyBandSelection(ctx.app, args.band, args.mode ?? 'replace');
      focused()?.redraw();
      return { count };
    },
  };
}

const TANGENTS: readonly (readonly [TangentType, string])[] = [
  ['auto', 'Auto'],
  ['spline', 'Spline'],
  ['clamped', 'Clamped'],
  ['linear', 'Linear'],
  ['flat', 'Flat'],
  ['step', 'Stepped'],
];

/**
 * Built-in RMB menu items. They act on `Selection.keys`, which the band selected; `time.selectBand` without `args`
 * gets the current band when the menu opens (`TimeSliderController.contextMenu`).
 */
export const TIMELINE_MENU_ITEMS: readonly MenuItemDef[] = [
  {
    id: 'timeline.context.delete',
    menu: TIMELINE_CONTEXT_MENU,
    op: 'graph.keys.delete',
    group: 'edit',
    order: 10,
    label: 'Delete Keys',
  },
  {
    id: 'timeline.context.copy',
    menu: TIMELINE_CONTEXT_MENU,
    op: 'graph.keys.copy',
    group: 'edit',
    order: 20,
    label: 'Copy Keys',
  },
  {
    id: 'timeline.context.paste',
    menu: TIMELINE_CONTEXT_MENU,
    op: 'graph.keys.paste',
    group: 'edit',
    order: 30,
    label: 'Paste Keys',
  },
  ...TANGENTS.map(
    ([type, label], index): MenuItemDef => ({
      id: `timeline.context.tangent-${type}`,
      menu: TIMELINE_CONTEXT_MENU,
      op: 'graph.tangent.set',
      args: { type },
      group: 'tangent',
      order: 10 * (index + 1),
      label,
    }),
  ),
  {
    id: 'timeline.context.select-in-graph',
    menu: TIMELINE_CONTEXT_MENU,
    op: 'time.selectBand',
    group: 'select',
    order: 10,
    label: 'Select Band Keys in Graph Editor',
  },
  // M2a (M2A-SPEC §5.9, §7): Ripple ✓, Insert Frame, Remove Frame, Delete Time.
  {
    id: 'timeline.context.ripple',
    menu: TIMELINE_CONTEXT_MENU,
    op: 'key.toggleRipple',
    group: 'time',
    order: 10,
    label: 'Ripple Edit',
  },
  {
    id: 'timeline.context.insert-frame',
    menu: TIMELINE_CONTEXT_MENU,
    op: 'time.insertTime',
    args: { frames: 1 },
    group: 'time',
    order: 20,
    label: 'Insert Frame',
  },
  {
    id: 'timeline.context.remove-frame',
    menu: TIMELINE_CONTEXT_MENU,
    op: 'time.insertTime',
    args: { frames: -1 },
    group: 'time',
    order: 30,
    label: 'Remove Frame',
  },
  {
    id: 'timeline.context.delete-time',
    menu: TIMELINE_CONTEXT_MENU,
    op: 'time.deleteTime',
    group: 'time',
    order: 40,
    label: 'Delete Time',
  },
];

/** Menu items whose operator toggles a session flag: the menu shows them checked while it is on. */
export const TIMELINE_CHECKED_OPS: ReadonlySet<string> = new Set(['key.toggleRipple']);

/**
 * A surface that shows the time band (STUDIO-TOUCH-SPEC §20.3 item 18): Studio Pro's time slider or Ekza Studio's
 * Thread. `time.selectBand` asks the focused one to draw at once.
 */
export interface BandSource {
  redraw(force?: boolean): void;
}

/** A provided band source: `focus()` makes it the one `time.selectBand` redraws; `dispose()` withdraws it. */
export interface BandSourceHandle {
  focus(): void;
  dispose(): void;
}

interface BandSources {
  readonly sources: BandSource[];
  focused: BandSource | null;
  unregister: Disposer | null;
}

const bandSources = new WeakMap<EditorApp, BandSources>();

/**
 * The focused band source seam (STUDIO-TOUCH-SPEC §20.3 item 18, T7): every surface that edits the band provides itself
 * here, and `time.selectBand` with the `timeline.context.*` items act on the focused one — the most recently provided
 * or focused. The first source registers the contributions unless another owner already has (Studio Pro's time slider
 * host registers them itself and keeps owning them); the last source to go removes what this seam registered. So a
 * shell without Pro's time slider (Halo's Thread) runs the same operators as Pro.
 */
export function provideBandSource(app: EditorApp, source: BandSource): BandSourceHandle {
  let entry = bandSources.get(app);
  if (entry === undefined) {
    entry = { sources: [], focused: null, unregister: null };
    bandSources.set(app, entry);
  }
  const current = entry;
  current.sources.push(source);
  current.focused = source;
  if (current.unregister === null && app.operators.get('time.selectBand') === undefined) {
    current.unregister = registerContributions(app, () => current.focused);
  }
  let disposed = false;
  return {
    focus() {
      if (!disposed) current.focused = source;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const index = current.sources.indexOf(source);
      if (index !== -1) current.sources.splice(index, 1);
      if (current.focused === source) current.focused = current.sources.at(-1) ?? null;
      if (current.sources.length > 0) return;
      current.unregister?.();
      current.unregister = null;
      bandSources.delete(app);
    },
  };
}

/** The focused band source of an app (tests, the e2e probe), or null. */
export function focusedBandSource(app: EditorApp): BandSource | null {
  return bandSources.get(app)?.focused ?? null;
}

/** Registers `time.selectBand` and the slider's menu items; the disposer removes them again. */
export function registerContributions(app: EditorApp, focused: FocusedSlider): Disposer {
  const disposers: Disposer[] = [];
  try {
    disposers.push(app.operators.register(selectBandOperator(focused)));
    for (const def of TIMELINE_MENU_ITEMS) disposers.push(app.contribute({ kind: 'menu', def }));
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
