// Channel value edits (MVP-SPEC §4.11.2): the one path by which the Channel Box, manipulators, reset, paste, mirror
// and plant feet change channel values. Per edit the channel's state and the key policy decide between a key, a
// static value (document) and a session pose override:
//
// | state            | key: 'force' | 'auto', auto-key on                       | 'auto', auto-key off | 'none'   |
// |------------------|--------------|-------------------------------------------|----------------------|----------|
// | curve with keys  | key at frame | key at frame                              | override             | override |
// | no keys          | curve + key  | 'all' → curve + key, else static value    | static value         | static   |
//
// Locked and non-keyable channels are skipped and reported (callers show one toast; the gesture helper does).
import { EkzaError } from '@ekza-animator/anim-core';
import type { ChannelId, ChannelValues, CharacterId, ControlId, Tx } from '@ekza-animator/doc';
import { internalsOf } from '../app/internals';
import { activeClipOf } from '../evaluation/time';
import type { CaptureOutcome } from '../history/capture';
import { type OverrideLocation, overrideDelta, sameLocation } from '../history/overrides';
import { activeLocation, ownerOfControl } from '../session/location';
import { selectionSnapshot } from '../session/selection';
import type { ChannelEdit, ChannelEditGesture, ChannelEditResult, EditorApp, KeyPolicy, OverrideDelta } from '../types';
import { isKeyable, isLocked } from './channelMeta';
import { currentClipFrame, ensureBaseLayer } from './context';
import { ensureCurve, writeKeyAt } from './keys';

type Outcome = 'key' | 'static' | 'override';

function outcomeFor(hasKeys: boolean, policy: KeyPolicy, autoKey: boolean, autoKeyMode: 'keyed-only' | 'all'): Outcome {
  if (hasKeys) {
    if (policy === 'force') return 'key';
    return policy === 'auto' && autoKey ? 'key' : 'override';
  }
  if (policy === 'force') return 'key';
  return policy === 'auto' && autoKey && autoKeyMode === 'all' ? 'key' : 'static';
}

/**
 * Applies channel edits inside `tx` per the §4.11.2 table at the current clip frame of each control's character
 * (its active clip). Keys and static values are written through `tx`; override values are merged into
 * `session.overrides`, and channels that were keyed or got a static value leave the overrides.
 */
export function applyChannelEdits(
  app: EditorApp,
  tx: Tx,
  edits: readonly ChannelEdit[],
  opts: { readonly key: KeyPolicy },
): ChannelEditResult {
  const prefs = app.prefs.getState();
  const state = app.session.getState();
  let keyed = 0;
  let statics = 0;
  const skipped: { control: ControlId; channel: ChannelId; reason: 'locked' | 'non-keyable' }[] = [];
  const overrideValues = new Map<ControlId, Partial<Record<ChannelId, number>>>();
  const cleared = new Map<ControlId, Set<ChannelId>>();
  const clear = (control: ControlId, channel: ChannelId): void => {
    const values = overrideValues.get(control);
    if (values !== undefined) delete values[channel];
    let channels = cleared.get(control);
    if (channels === undefined) {
      channels = new Set();
      cleared.set(control, channels);
    }
    channels.add(channel);
  };

  for (const edit of edits) {
    const control = tx.get('controls', edit.control);
    if (control === undefined) throw new EkzaError('invalid-record', `Control ${edit.control} does not exist`);
    if (!Number.isFinite(edit.value)) {
      throw new EkzaError('invalid-record', `${control.key}.${edit.channel}: the value must be finite`);
    }
    if (!isKeyable(control, edit.channel)) {
      skipped.push({ control: control.id, channel: edit.channel, reason: 'non-keyable' });
      continue;
    }
    if (isLocked(control, edit.channel)) {
      skipped.push({ control: control.id, channel: edit.channel, reason: 'locked' });
      continue;
    }
    const character: CharacterId | undefined = tx.get('rigs', control.rig)?.character;
    const clip = character === undefined ? undefined : activeClipOf(tx, state, character);
    if (clip === undefined) {
      throw new EkzaError('unsupported', `${control.name}: the character has no active clip to edit`);
    }
    const frame = currentClipFrame(app, tx, clip);
    const layer = ensureBaseLayer(app, tx, clip.id);
    const curve = tx.query.curveFor(clip.id, layer.id, control.id, edit.channel);
    const hasKeys = curve !== undefined && tx.query.keysOfCurve(curve.id).length > 0;
    switch (outcomeFor(hasKeys, opts.key, prefs.autoKey, prefs.autoKeyMode)) {
      case 'key': {
        const curveId = curve?.id ?? ensureCurve(app, tx, clip.id, control.id, edit.channel);
        writeKeyAt(app, tx, curveId, frame, edit.value, prefs.defaultTangents);
        keyed++;
        clear(control.id, edit.channel);
        break;
      }
      case 'static': {
        const curveId = curve?.id ?? ensureCurve(app, tx, clip.id, control.id, edit.channel);
        if (tx.get('curves', curveId)?.staticValue !== edit.value) {
          tx.patch('curves', curveId, { staticValue: edit.value });
        }
        statics++;
        clear(control.id, edit.channel);
        break;
      }
      case 'override': {
        let values = overrideValues.get(control.id);
        if (values === undefined) {
          values = {};
          overrideValues.set(control.id, values);
        }
        values[edit.channel] = edit.value;
        cleared.get(control.id)?.delete(edit.channel);
        break;
      }
    }
  }

  const merged = mergeOverrides(state.overrides, overrideValues, cleared);
  if (merged !== state.overrides) app.session.setState({ overrides: merged });
  const overrides = new Map<ControlId, ChannelValues>();
  for (const [control, values] of overrideValues) if (Object.keys(values).length > 0) overrides.set(control, values);
  return { keyed, statics, overrides, skipped };
}

/** `overrides` with `values` merged in and `cleared` channels removed; the same map when nothing changes. */
function mergeOverrides(
  overrides: ReadonlyMap<ControlId, ChannelValues>,
  values: ReadonlyMap<ControlId, Partial<Record<ChannelId, number>>>,
  cleared: ReadonlyMap<ControlId, ReadonlySet<ChannelId>>,
): ReadonlyMap<ControlId, ChannelValues> {
  let next: Map<ControlId, ChannelValues> | null = null;
  for (const control of new Set([...values.keys(), ...cleared.keys()])) {
    const current = overrides.get(control);
    const updated: Partial<Record<ChannelId, number>> = { ...current };
    for (const channel of cleared.get(control) ?? []) delete updated[channel];
    Object.assign(updated, values.get(control));
    const empty = Object.keys(updated).length === 0;
    if (empty && current === undefined) continue;
    if (!empty && current !== undefined && sameValues(current, updated)) continue;
    next ??= new Map(overrides);
    if (empty) next.delete(control);
    else next.set(control, updated);
  }
  return next ?? overrides;
}

function sameValues(a: ChannelValues, b: ChannelValues): boolean {
  const keys = Object.keys(a) as ChannelId[];
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

let nextChannelGesture = 0;

/**
 * One interactive channel edit (manipulator drag, Channel Box scrub): a preview session whose updates re-apply
 * `applyChannelEdits` from the gesture's starting overrides, committed as ONE document transaction and ONE editor
 * history step (doc entry and override delta). `cancel` — or a preview cancelled by someone else (Esc) — restores
 * the document and the overrides.
 *
 * M2a (M2A-SPEC §4.5, M-1 mechanism 1): updates are coalesced through `app.scheduleBeforeFrame`, so several pointer
 * moves within one animation frame cost one preview update (synchronous in Node); `commit` applies a pending update
 * first, `cancel` drops it.
 */
export function beginChannelEditGesture(
  app: EditorApp,
  label: string,
  opts: { readonly key: KeyPolicy },
): ChannelEditGesture {
  const preview = app.store.beginPreview(label);
  const start = app.session.getState();
  const startOverrides = start.overrides;
  const selectionBefore = selectionSnapshot(start.selection);
  const where = activeLocation(app);
  const skipped = new Set<string>();
  const gestures = internalsOf(app).gestures;
  const taskKey = `channelEditGesture:${nextChannelGesture++}`;
  let active = true;
  let pending: readonly ChannelEdit[] | null = null;

  const finish = (): void => {
    active = false;
    pending = null;
    gestures.delete(gesture);
    unsubscribe();
  };
  const abandon = (): void => {
    finish();
    app.session.setState({ overrides: startOverrides });
  };
  // A preview cancelled from outside (edit.escape) ends the gesture and restores its overrides.
  const unsubscribe = app.store.subscribe(() => {
    if (active && !preview.active) abandon();
  });

  const gesture: ChannelEditGesture = {
    get active() {
      return active && preview.active;
    },
    update(edits: readonly ChannelEdit[]): void {
      if (!active) return;
      pending = edits;
      app.scheduleBeforeFrame(taskKey, applyPending);
    },
    commit(): void {
      if (!active) return;
      applyPending();
      if (!active) return;
      if (!preview.active) {
        abandon();
        return;
      }
      finish();
      const capture = internalsOf(app).capture;
      const scope = capture?.begin() ?? null;
      const topBefore = app.store.undo.peekUndo()?.txId ?? null;
      let outcome: CaptureOutcome = { kind: 'none' };
      try {
        const batch = preview.commit({
          label,
          selectionBefore,
          selectionAfter: selectionSnapshot(app.session.getState().selection),
        });
        if (scope === null) {
          const top = app.store.undo.peekUndo();
          if (batch !== null && top !== null && top.txId === batch.txId && top.txId !== topBefore) {
            outcome = { kind: 'new', txId: top.txId, label };
          }
        }
      } catch (error) {
        // Nothing was written (read-only store, …): the gesture ends as if cancelled.
        if (preview.active) preview.cancel();
        app.session.setState({ overrides: startOverrides });
        throw error;
      } finally {
        if (capture !== null && scope !== null) outcome = capture.end(scope);
      }
      recordGestureStep(app, label, startOverrides, where, outcome);
      if (skipped.size > 0) {
        app.services.notify.toast({
          kind: 'warning',
          text: `${skipped.size} locked or non-keyable channel(s) were not changed`,
        });
      }
    },
    cancel(): void {
      if (!active) return;
      finish();
      preview.cancel();
      app.session.setState({ overrides: startOverrides });
    },
  };
  /** The latest pending update, re-applied from the starting overrides (the M1 update body). */
  function applyPending(): void {
    const edits = pending;
    pending = null;
    if (!active || edits === null) return;
    if (!preview.active) {
      abandon();
      return;
    }
    app.session.setState({ overrides: startOverrides });
    preview.update((tx) => {
      const result = applyChannelEdits(app, tx, edits, opts);
      for (const s of result.skipped) skipped.add(`${s.control}\u0000${s.channel}\u0000${s.reason}`);
    });
  }
  gestures.add(gesture);
  return gesture;
}

/** Cancels every channel-edit gesture in progress (Esc, `edit.escape`); true when there was one. */
export function cancelChannelEditGestures(app: EditorApp): boolean {
  const gestures = [...internalsOf(app).gestures];
  for (const gesture of gestures) gesture.cancel();
  return gestures.length > 0;
}

function recordGestureStep(
  app: EditorApp,
  label: string,
  startOverrides: ReadonlyMap<ControlId, ChannelValues>,
  where: OverrideLocation | null,
  outcome: CaptureOutcome,
): void {
  const docTxId = outcome.kind === 'new' || outcome.kind === 'coalesced' ? outcome.txId : null;
  const after = app.session.getState().overrides;
  // Overrides recorded only where they still apply (a frame or clip change during the drag discarded them).
  const delta: OverrideDelta | null =
    where !== null && sameLocation(where, activeLocation(app))
      ? overrideDelta(startOverrides, after, where, (control) => ownerOfControl(app.store, control))
      : null;
  // A gesture that keys overridden channels keeps the earlier override steps (see the runner's recordStep).
  if (docTxId !== null || delta !== null) app.history.record({ label, docTxId, overrides: delta });
}
