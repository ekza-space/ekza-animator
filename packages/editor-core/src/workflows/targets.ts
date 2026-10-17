// What the selection-driven operators act on (Graph Editor, time slider, keying, pose tools).
//
// - Keys: `selection.keys` entries whose key still exists (key parts and handle parts).
// - Curves (§4.9 graph rows, WP-6 request): the curves of the selected keys; else the curves of the selected channels;
//   else the curves of the selected controls; else every curve of the active clip — what the Graph Editor shows.
//   Always the active clip's base layer.
// - Controls: the selected ones; keying the character and selecting all use its visible controls.
import type {
  ChannelId,
  CharacterId,
  ClipRecord,
  ControlId,
  ControlRecord,
  CurveId,
  CurveRecord,
  KeyId,
  KeyRecord,
  ReadView,
} from '@ekza-animator/doc';
import { activeClipOf } from '../evaluation/time';
import type { EditorApp, KeyPartSelection, SessionState } from '../types';

export interface SelectedKey {
  readonly key: KeyRecord;
  readonly parts: KeyPartSelection;
}

/** Selected keys that still exist, in selection order. */
export function selectedKeys(app: EditorApp, view: ReadView = app.store): readonly SelectedKey[] {
  const out: SelectedKey[] = [];
  for (const [id, parts] of app.session.getState().selection.keys) {
    const key = view.get('keys', id);
    if (key !== undefined && (parts.key || parts.in || parts.out)) out.push({ key, parts });
  }
  return out;
}

/** Ids of the selected keys whose key part is selected (moving, deleting, copying act on these). */
export function selectedKeyIds(app: EditorApp, view: ReadView = app.store): readonly KeyId[] {
  return selectedKeys(app, view)
    .filter((s) => s.parts.key)
    .map((s) => s.key.id);
}

/** The active character's active clip. */
export function activeClipRecord(app: EditorApp, view: ReadView = app.store): ClipRecord | undefined {
  const state = app.session.getState();
  return state.activeCharacter === null ? undefined : activeClipOf(view, state, state.activeCharacter);
}

/** Controls of a character's rig, parents first. */
export function controlsOfCharacter(view: ReadView, character: CharacterId): readonly ControlRecord[] {
  const rig = view.query.rigOfCharacter(character);
  return rig === undefined ? [] : view.query.controlsOfRig(rig.id);
}

/** Shown in the viewport and outliner: not hidden by the user, secondary controls only when shown. */
export function isControlVisible(state: SessionState, control: ControlRecord): boolean {
  if (state.hiddenControls.has(control.id)) return false;
  return state.showSecondary || !control.hiddenByDefault;
}

/** Visible controls of the active character. */
export function visibleControls(app: EditorApp, view: ReadView = app.store): readonly ControlRecord[] {
  const state = app.session.getState();
  if (state.activeCharacter === null) return [];
  return controlsOfCharacter(view, state.activeCharacter).filter((control) => isControlVisible(state, control));
}

/** Selected controls that exist, in selection order (lead last). */
export function selectedControls(app: EditorApp, view: ReadView = app.store): readonly ControlRecord[] {
  const out: ControlRecord[] = [];
  for (const id of app.session.getState().selection.controls) {
    const control = view.get('controls', id);
    if (control !== undefined) out.push(control);
  }
  return out;
}

/** Base-layer curves of a clip, optionally limited to some controls. */
export function baseCurves(
  view: ReadView,
  clip: ClipRecord,
  controls?: ReadonlySet<ControlId>,
): readonly CurveRecord[] {
  const base = view.query.baseLayer(clip.id);
  if (base === undefined) return [];
  return view.query
    .curvesOfClip(clip.id)
    .filter((curve) => curve.layer === base.id && (controls === undefined || controls.has(curve.control)));
}

/** Curves the curve-level Graph Editor operators act on (see the header). */
export function targetCurves(app: EditorApp, view: ReadView = app.store): readonly CurveRecord[] {
  const keys = selectedKeys(app, view);
  if (keys.length > 0) {
    const seen = new Set<CurveId>();
    const curves: CurveRecord[] = [];
    for (const { key } of keys) {
      if (seen.has(key.curve)) continue;
      seen.add(key.curve);
      const curve = view.get('curves', key.curve);
      if (curve !== undefined) curves.push(curve);
    }
    return curves;
  }
  const clip = activeClipRecord(app, view);
  if (clip === undefined) return [];
  const channels = app.session.getState().selection.channels;
  if (channels.length > 0) {
    const wanted = new Set(channels.map((ref) => `${ref.control}\u0000${ref.channel}`));
    return baseCurves(view, clip).filter((curve) => wanted.has(`${curve.control}\u0000${curve.channel}`));
  }
  const selected = selectedControls(app, view);
  if (selected.length > 0) return baseCurves(view, clip, new Set(selected.map((control) => control.id)));
  return baseCurves(view, clip);
}

/** Every key of the given curves. */
export function keysOfCurves(view: ReadView, curves: readonly CurveRecord[]): readonly KeyId[] {
  return curves.flatMap((curve) => view.query.keysOfCurve(curve.id).map((key) => key.id));
}

/** Sorted unique key times of the given controls' base-layer curves in a clip (all controls when null). */
export function keyTimes(view: ReadView, clip: ClipRecord, controls: ReadonlySet<ControlId> | null): readonly number[] {
  const times = new Set<number>();
  for (const curve of baseCurves(view, clip, controls ?? undefined)) {
    for (const key of view.query.keysOfCurve(curve.id)) times.add(key.t);
  }
  return [...times].sort((a, b) => a - b);
}

/** The base-layer curve of a control channel in a clip. */
export function curveOf(
  view: ReadView,
  clip: ClipRecord,
  control: ControlId,
  channel: ChannelId,
): CurveRecord | undefined {
  const base = view.query.baseLayer(clip.id);
  return base === undefined ? undefined : view.query.curveFor(clip.id, base.id, control, channel);
}
