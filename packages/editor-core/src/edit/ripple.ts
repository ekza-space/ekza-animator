// Ripple scope (M2A-SPEC §5.11, A3): ripple edits use ONE global region over the curves of the edit's control set,
// never per-curve bounds. The control set depends on where the edit comes from: the time slider's band targets (the
// selected controls of the active character, all of them when none is selected) or the controls the Dope Sheet shows
// (its "Show" setting). Panels that show their own set register a provider for their panel kind, so operators run
// from the keymap (the arrow-key nudge, paste insert) ripple over what that panel shows.
import type { Disposer, Frame } from '@ekza-animator/anim-core';
import type { ClipId, ControlId, CurveId, KeyId, ReadView } from '@ekza-animator/doc';
import type { EditorApp, PanelKind } from '../types';

/** The ripple of one edit (§5.11): the scope curves and the region before the edit. */
export interface RippleScope {
  /** Curves whose keys ripple (the edit's control set in the edited keys' clip, base layer). */
  readonly curves: readonly CurveId[];
  /**
   * Region `[a, b]` before the edit: the time-slider band, or absent for the min…max time of the edited keys (the
   * Dope Sheet region bar). The edited keys always lie inside the region used.
   */
  readonly region?: { readonly start: Frame; readonly end: Frame } | null;
}

/** The controls a panel shows for ripple purposes; null when the panel has nothing to say (default rule). */
export type RippleControlsProvider = () => readonly ControlId[] | null;

const providers = new WeakMap<EditorApp, Map<PanelKind, RippleControlsProvider[]>>();

/** Registers the ripple control set of a panel kind (the newest registration wins); the disposer removes it. */
export function registerRippleControls(app: EditorApp, panel: PanelKind, provider: RippleControlsProvider): Disposer {
  let byPanel = providers.get(app);
  if (byPanel === undefined) {
    byPanel = new Map();
    providers.set(app, byPanel);
  }
  let stack = byPanel.get(panel);
  if (stack === undefined) {
    stack = [];
    byPanel.set(panel, stack);
  }
  stack.push(provider);
  const owned = stack;
  return () => {
    const index = owned.lastIndexOf(provider);
    if (index !== -1) owned.splice(index, 1);
  };
}

/**
 * The default control set of a clip (the time slider's targets, §4.11.17): the selected controls of the clip's
 * character, or all of its controls when none of them is selected.
 */
export function defaultRippleControls(app: EditorApp, view: ReadView, clip: ClipId): readonly ControlId[] {
  const record = view.get('clips', clip);
  const rig = record === undefined ? undefined : view.query.rigOfCharacter(record.character);
  if (rig === undefined) return [];
  const own = view.query.controlsOfRig(rig.id).map((control) => control.id);
  const mine = new Set(own);
  const selected = app.session.getState().selection.controls.filter((control) => mine.has(control));
  return selected.length > 0 ? selected : own;
}

/** The ripple control set of `panel` (its registered provider, else the default rule). */
export function rippleControls(
  app: EditorApp,
  view: ReadView,
  clip: ClipId,
  panel: PanelKind | null,
): readonly ControlId[] {
  if (panel !== null) {
    const provider = providers.get(app)?.get(panel)?.at(-1);
    const controls = provider?.() ?? null;
    if (controls !== null) return controls;
  }
  return defaultRippleControls(app, view, clip);
}

/** Base-layer curves of `clip` that animate one of `controls`. */
export function rippleCurves(view: ReadView, clip: ClipId, controls: readonly ControlId[]): CurveId[] {
  const base = view.query.baseLayer(clip);
  if (base === undefined) return [];
  const wanted = new Set(controls);
  return view.query
    .curvesOfClip(clip)
    .filter((curve) => curve.layer === base.id && wanted.has(curve.control))
    .map((curve) => curve.id);
}

/** The clip of the first existing key of `keys` (null when none exists). */
export function clipOfKeys(view: ReadView, keys: readonly KeyId[]): ClipId | null {
  for (const id of keys) {
    const key = view.get('keys', id);
    if (key !== undefined) return key.clip;
  }
  return null;
}

/**
 * The ripple scope of an edit of `keys` run from `panel` (§5.11): the panel's control set in the keys' clip, with
 * `region` (the time-slider band) or the edited keys' min…max when absent.
 */
export function rippleScopeOf(
  app: EditorApp,
  view: ReadView,
  keys: readonly KeyId[],
  panel: PanelKind | null,
  region?: { readonly start: Frame; readonly end: Frame } | null,
): RippleScope {
  const clip = clipOfKeys(view, keys);
  if (clip === null) return { curves: [] };
  const curves = rippleCurves(view, clip, rippleControls(app, view, clip, panel));
  return region === undefined || region === null ? { curves } : { curves, region };
}
