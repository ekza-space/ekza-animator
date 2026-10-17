// Override bookkeeping shared by the runner, the gesture helper and the history: session pose overrides are
// `ControlId → ChannelValues`; history steps store the before/after values of the controls a step changed.
import type { Frame } from '@ekza-animator/anim-core';
import type { CharacterId, ChannelValues, ClipId, ControlId } from '@ekza-animator/doc';
import type { OverrideDelta } from '../types';

/** Where overrides live: the active character's active clip at its clip frame. */
export interface OverrideLocation {
  readonly character: CharacterId;
  readonly clip: ClipId;
  readonly clipFrame: Frame;
}

export function sameLocation(a: OverrideLocation | null, b: OverrideLocation | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.character === b.character &&
    a.clip === b.clip &&
    Math.abs(a.clipFrame - b.clipFrame) < 1e-9
  );
}

export function channelValuesEqual(a: ChannelValues | undefined, b: ChannelValues | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const keys = Object.keys(a) as (keyof ChannelValues)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.is(a[key], b[key]));
}

/** The controls whose overrides differ, as an OverrideDelta at `where`; null when nothing changed. */
export function overrideDelta(
  before: ReadonlyMap<ControlId, ChannelValues>,
  after: ReadonlyMap<ControlId, ChannelValues>,
  where: OverrideLocation,
): OverrideDelta | null {
  if (before === after) return null;
  const changedBefore = new Map<ControlId, ChannelValues>();
  const changedAfter = new Map<ControlId, ChannelValues>();
  let changed = false;
  for (const control of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(control);
    const b = after.get(control);
    if (channelValuesEqual(a, b)) continue;
    changed = true;
    if (a !== undefined) changedBefore.set(control, a);
    if (b !== undefined) changedAfter.set(control, b);
  }
  return changed ? { ...where, before: changedBefore, after: changedAfter } : null;
}

/** Controls that had overrides before and have none after (consumed by keying). */
export function consumedControls(
  before: ReadonlyMap<ControlId, ChannelValues>,
  after: ReadonlyMap<ControlId, ChannelValues>,
): ControlId[] {
  return [...before.keys()].filter((control) => !after.has(control));
}

/** Two consecutive deltas as one: the earliest `before` and the latest `after` of every touched control. */
export function mergeDeltas(first: OverrideDelta | null, second: OverrideDelta | null): OverrideDelta | null {
  if (first === null) return second;
  if (second === null) return first;
  const touchedFirst = new Set([...first.before.keys(), ...first.after.keys()]);
  const before = new Map(first.before);
  for (const [control, values] of second.before) if (!touchedFirst.has(control)) before.set(control, values);
  const after = new Map(first.after);
  for (const control of new Set([...second.before.keys(), ...second.after.keys()])) {
    const values = second.after.get(control);
    if (values === undefined) after.delete(control);
    else after.set(control, values);
  }
  return { ...second, before, after };
}

/** The delta without the given controls; null when nothing is left. */
export function withoutControls(delta: OverrideDelta, controls: ReadonlySet<ControlId>): OverrideDelta | null {
  const before = new Map([...delta.before].filter(([control]) => !controls.has(control)));
  const after = new Map([...delta.after].filter(([control]) => !controls.has(control)));
  return before.size === 0 && after.size === 0 ? null : { ...delta, before, after };
}

/** `overrides` with the given controls' entries replaced by `values` (absent → removed). */
export function applyOverrideValues(
  overrides: ReadonlyMap<ControlId, ChannelValues>,
  controls: Iterable<ControlId>,
  values: ReadonlyMap<ControlId, ChannelValues>,
): Map<ControlId, ChannelValues> {
  const next = new Map(overrides);
  for (const control of controls) {
    const value = values.get(control);
    if (value === undefined) next.delete(control);
    else next.set(control, value);
  }
  return next;
}
