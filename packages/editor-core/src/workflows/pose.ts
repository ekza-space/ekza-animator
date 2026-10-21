// Pose values for the pose tools (copy, paste, mirror, reset, plant feet): the current channel values of controls
// (curves ⊕ static values ⊕ overrides at the active clip frame) and the channel edits that bring controls to new
// values. Edits go through `applyChannelEdits` (§4.11.2); unchanged channels are left alone so a pose tool does not
// key or override channels it did not move.
//
// M2a (M2A-SPEC §5.1 rules 4 and 6, §5.8; A2): attribute channels ('@name') take part like TRS channels, except
// `keyAll: false` ones (`ikFk`, `soft`: modes and settings): reset always leaves them alone (rule 6), and the pose
// clipboard carries and pastes them only when they are selected Channel Box channels (rule 4). Mirroring maps
// attributes by `AttrDef.mirror` ('copy' or 'negate'), so a mirrored pose carries the limb mode with it.
import {
  type ChannelId,
  type ChannelValues,
  type ControlId,
  type ControlRecord,
  type ReadView,
  TRS_CHANNELS,
} from '@ekza-studio/doc';
import type { MirrorMode, PoseClipboard } from '@ekza-studio/rig';
import { attrChannelsOf, attrDefOf, channelDefaultOf, isKeyAllChannel, isKeyable, isLocked } from '../edit/channelMeta';
import type { ChannelEdit, EditorApp } from '../types';

/** A change below this (radians, metres, unitless) is no change. */
const SAME_VALUE = 1e-12;
const NO_CHANNELS: ReadonlySet<ChannelId> = new Set();

/** Current TRS values of each control (`evaluation.channelValues`). */
export function currentValues(app: EditorApp, controls: Iterable<ControlId>): Map<ControlId, ChannelValues> {
  const values = new Map<ControlId, ChannelValues>();
  for (const control of controls) values.set(control, { ...app.evaluation.channelValues(control) });
  return values;
}

/** The selected Channel Box channels of a control (explicit choices that override the `keyAll` rule). */
export function selectedChannelsOf(app: EditorApp, control: ControlId): ReadonlySet<ChannelId> {
  const out = new Set<ChannelId>();
  for (const ref of app.session.getState().selection.channels) if (ref.control === control) out.add(ref.channel);
  return out;
}

/**
 * The attribute channels a pose tool acts on for a control (§5.1 rule 4): keyable attributes, without
 * `keyAll: false` ones unless they are selected Channel Box channels.
 */
export function poseAttrChannels(app: EditorApp, control: ControlRecord): readonly `@${string}`[] {
  const explicit = selectedChannelsOf(app, control.id);
  return attrChannelsOf(control).filter(
    (channel) => isKeyable(control, channel) && (isKeyAllChannel(control, channel) || explicit.has(channel)),
  );
}

/**
 * Current attribute values per control (controls without any are left out): the pose tools' attribute channels, or
 * with `which: 'keyable'` every keyable attribute (the mirror carries `ikFk` too, §5.8).
 */
export function currentAttrValues(
  app: EditorApp,
  controls: Iterable<ControlId>,
  which: 'pose' | 'keyable' = 'pose',
): Map<ControlId, ChannelValues> {
  const values = new Map<ControlId, ChannelValues>();
  for (const id of controls) {
    const control = app.store.get('controls', id);
    if (control === undefined) continue;
    const channels =
      which === 'pose'
        ? poseAttrChannels(app, control)
        : attrChannelsOf(control).filter((channel) => isKeyable(control, channel));
    if (channels.length === 0) continue;
    const out: ChannelValues = {};
    for (const channel of channels) out[channel] = app.evaluation.channelValue(id, channel);
    values.set(id, out);
  }
  return values;
}

/**
 * Edits that set the given values on keyable, unlocked channels whose value differs from the current one. Locked
 * channels are reported as `skipped` so the caller can say so. TRS channels first, then the '@name' attributes the
 * values name (unknown or non-keyable attributes are ignored).
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
    for (const channel of Object.keys(target) as ChannelId[]) {
      if (!channel.startsWith('@')) continue;
      const value = target[channel];
      if (value === undefined || !Number.isFinite(value) || !isKeyable(control, channel)) continue;
      if (Math.abs(value - app.evaluation.channelValue(id, channel)) <= SAME_VALUE) continue;
      edits.push({ control: id, channel, value });
    }
  }
  return { edits, locked };
}

/**
 * The rest values of the given controls: 0 for translate/rotate and 1 for scale on every keyable TRS channel, and
 * `AttrDef.default` on the keyable pose attributes. `keyAll: false` attributes are always left alone, selected
 * Channel Box channels included, so a reset never flips a limb between IK and FK (§5.1 rule 6; the selected-channel
 * exception of rule 4 is for keying and the clipboard).
 */
export function restValues(app: EditorApp, controls: Iterable<ControlId>): Map<ControlId, ChannelValues> {
  const values = new Map<ControlId, ChannelValues>();
  for (const id of controls) {
    const control = app.store.get('controls', id);
    if (control === undefined) continue;
    const rest: ChannelValues = {};
    for (const channel of TRS_CHANNELS) {
      if (isKeyable(control, channel)) rest[channel] = channel.startsWith('s') ? 1 : 0;
    }
    for (const channel of attrChannelsOf(control)) {
      if (isKeyable(control, channel) && isKeyAllChannel(control, channel)) {
        rest[channel] = channelDefaultOf(control, channel);
      }
    }
    values.set(id, rest);
  }
  return values;
}

/** An attribute value mirrored by its `AttrDef.mirror` ('negate' flips the sign; default 'copy'). */
export function mirrorAttrValue(control: ControlRecord, channel: ChannelId, value: number): number {
  return attrDefOf(control, channel)?.mirror === 'negate' ? 0 - value : value;
}

/**
 * Attribute values of a pose mirror (§5.8), next to the rig's TRS mirror: for every control of `scope` (the whole
 * character when null) that the mode writes, the source control's attribute values mapped by `AttrDef.mirror`. The
 * source is the mirror counterpart (`flip`: both ways, centre controls onto themselves; `leftToRight`: L onto R;
 * `rightToLeft`: R onto L). Reads come from `snapshot` (all controls' current attribute values).
 */
export function mirrorAttrValues(
  view: ReadView,
  controls: readonly ControlRecord[],
  snapshot: ReadonlyMap<ControlId, ChannelValues>,
  mode: MirrorMode,
  scope: ReadonlySet<ControlId> | null,
): Map<ControlId, ChannelValues> {
  const out = new Map<ControlId, ChannelValues>();
  for (const target of controls) {
    if (scope !== null && !scope.has(target.id)) continue;
    let source: ControlRecord | undefined;
    if (target.mirror === null) source = mode === 'flip' && target.side === 'C' ? target : undefined;
    else {
      const other = view.get('controls', target.mirror);
      if (other === undefined) continue;
      const writes = mode === 'flip' || (mode === 'leftToRight' ? target.side === 'R' : target.side === 'L');
      source = writes ? other : undefined;
    }
    if (source === undefined) continue;
    const from = snapshot.get(source.id);
    if (from === undefined) continue;
    const values: ChannelValues = {};
    for (const channel of attrChannelsOf(target)) {
      const value = from[channel];
      if (value === undefined || !isKeyable(target, channel)) continue;
      values[channel] = mirrorAttrValue(source, channel, value);
    }
    if (Object.keys(values).length > 0) out.set(target.id, values);
  }
  return out;
}

/** Merges attribute values into TRS values per control (a channel already present wins: the rig's result). */
export function mergeChannelValues(
  base: Map<ControlId, ChannelValues>,
  extra: ReadonlyMap<ControlId, ChannelValues>,
): Map<ControlId, ChannelValues> {
  for (const [control, values] of extra) {
    const current = base.get(control);
    base.set(control, current === undefined ? { ...values } : { ...values, ...current });
  }
  return base;
}

/**
 * The pose clipboard with the attribute values of the copied controls added to each entry (§5.8 "the pose clipboard
 * carries attribute values except `keyAll: false` ones"); entries the rig already filled keep their channels.
 */
export function withClipboardAttrs(
  clipboard: PoseClipboard,
  view: ReadView,
  attrs: ReadonlyMap<ControlId, ChannelValues>,
): PoseClipboard {
  if (attrs.size === 0) return clipboard;
  const controls: Record<string, PoseClipboard['controls'][string]> = { ...clipboard.controls };
  for (const [id, values] of attrs) {
    const control = view.get('controls', id);
    const entry = control === undefined ? undefined : controls[control.key];
    if (control === undefined || entry === undefined) continue;
    controls[control.key] = { ...entry, values: { ...values, ...entry.values } };
  }
  return { ...clipboard, controls };
}

/**
 * Attribute values to paste from a pose clipboard onto the controls of `controls` (by template key; `mirrored`
 * pastes the counterpart's entry mapped by `AttrDef.mirror`), keyable attributes only. A `keyAll: false` value is
 * pasted only when that channel is a selected Channel Box channel of the target control (`explicit`), the same rule
 * as the copy (§5.1 rule 4); otherwise it is dropped (a clipboard written elsewhere may carry it).
 */
export function clipboardAttrValues(
  view: ReadView,
  clipboard: PoseClipboard,
  controls: readonly ControlRecord[],
  mirrored: boolean,
  explicit: (control: ControlId) => ReadonlySet<ChannelId> = () => NO_CHANNELS,
): Map<ControlId, ChannelValues> {
  const out = new Map<ControlId, ChannelValues>();
  const byId = new Map(controls.map((control) => [control.id, control]));
  for (const target of controls) {
    let sourceKey = target.key;
    let source: ControlRecord = target;
    if (mirrored) {
      if (target.mirror !== null) {
        const other = byId.get(target.mirror) ?? view.get('controls', target.mirror);
        if (other === undefined) continue;
        sourceKey = other.key;
        source = other;
      } else if (target.side !== 'C') continue;
    }
    const entry = clipboard.controls[sourceKey];
    if (entry === undefined || entry === null || typeof entry.values !== 'object') continue;
    const values: ChannelValues = {};
    let selected: ReadonlySet<ChannelId> | undefined;
    for (const channel of attrChannelsOf(target)) {
      const value = (entry.values as Record<string, unknown>)[channel];
      if (typeof value !== 'number' || !Number.isFinite(value) || !isKeyable(target, channel)) continue;
      if (!isKeyAllChannel(target, channel) && !(selected ??= explicit(target.id)).has(channel)) continue;
      values[channel] = mirrored ? mirrorAttrValue(source, channel, value) : value;
    }
    if (Object.keys(values).length > 0) out.set(target.id, values);
  }
  return out;
}
