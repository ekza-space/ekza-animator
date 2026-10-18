// Pose values for the pose tools (copy, paste, mirror, reset, plant feet): the current channel values of controls
// (curves ⊕ static values ⊕ overrides at the active clip frame) and the channel edits that bring controls to new
// values. Edits go through `applyChannelEdits` (§4.11.2); unchanged channels are left alone so a pose tool does not
// key or override channels it did not move.
import { type ChannelValues, type ControlId, TRS_CHANNELS } from '@ekza-animator/doc';
import { isKeyable, isLocked } from '../edit/channelMeta';
import type { ChannelEdit, EditorApp } from '../types';

/** A change below this (radians, metres, unitless) is no change. */
const SAME_VALUE = 1e-12;

/** Current TRS values of each control (`evaluation.channelValues`). */
export function currentValues(app: EditorApp, controls: Iterable<ControlId>): Map<ControlId, ChannelValues> {
  const values = new Map<ControlId, ChannelValues>();
  for (const control of controls) values.set(control, { ...app.evaluation.channelValues(control) });
  return values;
}

/**
 * Edits that set the given values on keyable, unlocked channels whose value differs from the current one. Locked
 * channels are reported as `skipped` so the caller can say so.
 */
export function editsFromValues(
  app: EditorApp,
  values: ReadonlyMap<ControlId, ChannelValues>,
): { readonly edits: readonly ChannelEdit[]; readonly locked: number } {
  const edits: ChannelEdit[] = [];
  let locked = 0;
  for (const [id, target] of values) {
    const control = app.store.get('controls', id);
    if (control === undefined) continue;
    const current = app.evaluation.channelValues(id);
    for (const channel of TRS_CHANNELS) {
      const value = target[channel];
      if (value === undefined || !Number.isFinite(value) || !isKeyable(control, channel)) continue;
      if (Math.abs(value - current[channel]) <= SAME_VALUE) continue;
      if (isLocked(control, channel)) {
        locked++;
        continue;
      }
      edits.push({ control: id, channel, value });
    }
  }
  return { edits, locked };
}

/** The rest values (0 for translate/rotate, 1 for scale) of every keyable channel of the given controls. */
export function restValues(app: EditorApp, controls: Iterable<ControlId>): Map<ControlId, ChannelValues> {
  const values = new Map<ControlId, ChannelValues>();
  for (const id of controls) {
    const control = app.store.get('controls', id);
    if (control === undefined) continue;
    const rest: ChannelValues = {};
    for (const channel of TRS_CHANNELS) {
      if (isKeyable(control, channel)) rest[channel] = channel.startsWith('s') ? 1 : 0;
    }
    values.set(id, rest);
  }
  return values;
}
