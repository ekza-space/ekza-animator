// Keying and channel operators (MVP-SPEC §4.9 `key.*`, `channel.*`; §4.11.1 keying, §4.11.2 value edits).
import { EkzaError } from '@ekza-animator/anim-core';
import {
  type Axes,
  type ChannelId,
  type ChannelValues,
  type ControlId,
  type ControlRecord,
  TRS_CHANNELS,
  type TrsChannel,
} from '@ekza-animator/doc';
import { isKeyable, isLocked, trsSlot } from '../../edit/channelMeta';
import { applyChannelEdits } from '../../edit/channels';
import { currentClipFrame } from '../../edit/context';
import { deleteKeys, ensureCurve, writeKeyAt } from '../../edit/keys';
import { activeClipOf } from '../../evaluation/time';
import { ownerOfControl } from '../../session/location';
import { type ChannelEditResult, type EditorApp, GLOBAL_SCOPE, type KeyPolicy } from '../../types';
import { activeClipRecord, curveOf, selectedControls, visibleControls } from '../../workflows/targets';
import type { CountResult, KeyChannels } from '../args';
import { type AnyOperator, all, defineOperator, fail, isFiniteNumber, isRecord, OK, optionalArgs } from './define';
import { pollActiveClip, pollClipEdit, pollEditable } from './polls';

const KEY_CHANNELS: readonly KeyChannels[] = ['all', 'translate', 'rotate', 'scale', 'selected'];
const KEY_POLICIES: readonly KeyPolicy[] = ['auto', 'force', 'none'];
const ROTATIONS: readonly TrsChannel[] = ['rx', 'ry', 'rz'];
/** Two keys this close (frames) share a frame (§4.11.1). */
const SAME_FRAME = 1e-6;

interface KeySetArgs {
  readonly channels: KeyChannels;
  readonly target: 'selected' | 'character';
}

function keySetArgs(app: EditorApp, args: unknown): KeySetArgs | string {
  const options = optionalArgs(args);
  if (options === null) return 'expects { channels?, target? }';
  const channels = options['channels'] ?? 'all';
  const target = options['target'] ?? app.session.getState().tools.keyTarget;
  if (!KEY_CHANNELS.includes(channels as KeyChannels)) return `unknown channels ${JSON.stringify(channels)}`;
  if (target !== 'selected' && target !== 'character') return `unknown target ${JSON.stringify(target)}`;
  return { channels: channels as KeyChannels, target };
}

function keyTargets(app: EditorApp, args: KeySetArgs): readonly ControlRecord[] {
  return args.target === 'character' ? visibleControls(app) : selectedControls(app);
}

/** Channels `key.set` keys on a control (§4.11.1 rule 2): keyable, unlocked; rotations always as a triple. */
export function keyChannelsOf(app: EditorApp, control: ControlRecord, which: KeyChannels): readonly TrsChannel[] {
  const usable = (channel: TrsChannel): boolean => isKeyable(control, channel) && !isLocked(control, channel);
  let channels: TrsChannel[];
  switch (which) {
    case 'all':
      channels = [...TRS_CHANNELS];
      break;
    case 'translate':
      channels = ['tx', 'ty', 'tz'];
      break;
    case 'rotate':
      channels = [...ROTATIONS];
      break;
    case 'scale':
      channels = ['sx', 'sy', 'sz'];
      break;
    case 'selected':
      channels = app.session
        .getState()
        .selection.channels.filter((ref) => ref.control === control.id && trsSlot(ref.channel) !== -1)
        .map((ref) => ref.channel as TrsChannel);
      break;
  }
  const picked = new Set(channels.filter(usable));
  if (ROTATIONS.some((channel) => picked.has(channel)))
    for (const channel of ROTATIONS) if (usable(channel)) picked.add(channel);
  return TRS_CHANNELS.filter((channel) => picked.has(channel));
}

const KEY_LABEL: Readonly<Record<KeyChannels, string>> = {
  all: 'Set Key',
  selected: 'Set Key',
  translate: 'Key Translate',
  rotate: 'Key Rotate',
  scale: 'Key Scale',
};

const keySet = defineOperator({
  id: 'key.set',
  label: 'Set Key',
  description: 'Key the channels of the selected controls (or the whole character) at the current frame.',
  category: 'key',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel(args) {
    const channels = (optionalArgs(args)?.['channels'] ?? 'all') as KeyChannels;
    return KEY_LABEL[channels] ?? 'Set Key';
  },
  poll({ app }, args) {
    const parsed = keySetArgs(app, args);
    if (typeof parsed === 'string') return fail(parsed);
    const base = all(pollEditable(app), pollActiveClip(app));
    if (base !== true) return base;
    const targets = keyTargets(app, parsed);
    if (targets.length === 0) return fail('nothing selected');
    if (parsed.channels === 'selected' && targets.every((c) => keyChannelsOf(app, c, 'selected').length === 0)) {
      return fail('No keyable channels are selected');
    }
    return OK;
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'key.set runs in a transaction');
    const parsed = keySetArgs(app, args);
    if (typeof parsed === 'string') throw new EkzaError('invalid-record', parsed);
    const state = app.session.getState();
    const prefs = app.prefs.getState();
    let count = 0;
    const keyed = new Map<ControlId, Set<ChannelId>>();
    for (const control of keyTargets(app, parsed)) {
      const channels = keyChannelsOf(app, control, parsed.channels);
      if (channels.length === 0) continue;
      const owner = ownerOfControl(tx, control.id);
      const clip = owner === null ? undefined : activeClipOf(tx, state, owner);
      if (clip === undefined) continue;
      const frame = currentClipFrame(app, tx, clip);
      const values = app.evaluation.channelValues(control.id);
      for (const channel of channels) {
        const curve = ensureCurve(app, tx, clip.id, control.id, channel);
        writeKeyAt(app, tx, curve, frame, values[channel], prefs.defaultTangents);
        count++;
      }
      keyed.set(control.id, new Set(channels));
    }
    // Keyed channels leave the overrides (§4.11.1 rule 5); the runner drops their history parts.
    const overrides = new Map(state.overrides);
    let changed = false;
    for (const [control, channels] of keyed) {
      const current = overrides.get(control);
      if (current === undefined) continue;
      const rest: ChannelValues = {};
      for (const [channel, value] of Object.entries(current) as [ChannelId, number][]) {
        if (!channels.has(channel)) rest[channel] = value;
      }
      if (Object.keys(rest).length === Object.keys(current).length) continue;
      changed = true;
      if (Object.keys(rest).length === 0) overrides.delete(control);
      else overrides.set(control, rest);
    }
    if (changed) app.session.setState({ overrides });
    return { count } satisfies CountResult;
  },
});

const keyDeleteAtFrame = defineOperator({
  id: 'key.deleteAtFrame',
  label: 'Delete Keys at Frame',
  description: "Delete the selected controls' keys at the current frame.",
  category: 'key',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: () => 'Delete Keys',
  poll: ({ app }) => all(pollClipEdit(app), selectedControls(app).length > 0 ? OK : fail('nothing selected')),
  apply({ app, tx }) {
    if (tx === null) throw new EkzaError('internal', 'key.deleteAtFrame runs in a transaction');
    const clip = activeClipRecord(app, tx);
    if (clip === undefined) return { count: 0 };
    const frame = currentClipFrame(app, tx, clip);
    const keys = [];
    for (const control of selectedControls(app, tx)) {
      for (const channel of TRS_CHANNELS) {
        const curve = curveOf(tx, clip, control.id, channel);
        if (curve === undefined || curve.locked) continue;
        for (const key of tx.query.keysOfCurve(curve.id)) if (Math.abs(key.t - frame) < SAME_FRAME) keys.push(key.id);
      }
    }
    const count = deleteKeys(app, tx, keys);
    const selection = app.session.getState().selection;
    if (keys.some((id) => selection.keys.has(id))) {
      const remaining = new Map(selection.keys);
      for (const id of keys) remaining.delete(id);
      app.session.setState({ selection: { ...selection, keys: remaining } });
    }
    return { count };
  },
});

const keyToggleAutoKey = defineOperator({
  id: 'key.toggleAutoKey',
  label: 'Auto Key',
  description: 'Key channels that already have keys whenever they are edited.',
  category: 'key',
  scope: GLOBAL_SCOPE,
  apply({ app }) {
    app.prefs.setState({ autoKey: !app.prefs.getState().autoKey });
  },
});

function editsProblem(app: EditorApp, edits: unknown): string | null {
  if (!Array.isArray(edits)) return 'expects { edits }';
  for (const edit of edits as readonly unknown[]) {
    if (!isRecord(edit) || typeof edit['control'] !== 'string' || typeof edit['channel'] !== 'string') {
      return 'each edit is { control, channel, value }';
    }
    if (!isFiniteNumber(edit['value'])) return 'edit values must be finite numbers';
    if (app.store.get('controls', edit['control'] as ControlId) === undefined) {
      return `Control ${edit['control']} does not exist`;
    }
  }
  return null;
}

function toastSkipped(app: EditorApp, result: ChannelEditResult): void {
  if (result.skipped.length === 0) return;
  const locked = result.skipped.filter((s) => s.reason === 'locked').length;
  const parts = [
    ...(locked > 0 ? [`${locked} locked`] : []),
    ...(result.skipped.length > locked ? [`${result.skipped.length - locked} non-keyable`] : []),
  ];
  app.services.notify.toast({ kind: 'warning', text: `Not changed: ${parts.join(', ')} channel(s)` });
}

const channelSetValues = defineOperator({
  id: 'channel.setValues',
  label: 'Set Channel Values',
  description: 'Set channel values (keys, static values or pose overrides per the auto-key rules).',
  category: 'channel',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  undoLabel: (args) => (typeof args.label === 'string' && args.label !== '' ? args.label : 'Set Value'),
  poll({ app }, raw) {
    const args: unknown = raw;
    if (!isRecord(args)) return fail('expects { edits, key?, label? }');
    const problem = editsProblem(app, args['edits']);
    if (problem !== null) return fail(problem);
    if (args['key'] !== undefined && !KEY_POLICIES.includes(args['key'] as KeyPolicy))
      return fail('unknown key policy');
    return pollEditable(app);
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'channel.setValues runs in a transaction');
    const result = applyChannelEdits(app, tx, args.edits, { key: args.key ?? 'auto' });
    toastSkipped(app, result);
    return result;
  },
});

const channelToggleLock = defineOperator({
  id: 'channel.toggleLock',
  label: 'Lock Channels',
  description: 'Lock or unlock channels (all of them lock unless every one is locked already).',
  category: 'channel',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) => (args.locked === false ? 'Unlock Channels' : 'Lock Channels'),
  poll({ app }, args) {
    if (!isRecord(args) || !Array.isArray(args['refs'])) return fail('expects { refs, locked? }');
    if (args['locked'] !== undefined && typeof args['locked'] !== 'boolean') return fail('locked must be a boolean');
    const refs = args['refs'] as readonly unknown[];
    if (refs.length === 0) return fail('No channels are selected');
    for (const ref of refs) {
      if (!isRecord(ref) || typeof ref['control'] !== 'string' || typeof ref['channel'] !== 'string') {
        return fail('refs must be { control, channel }');
      }
      if (trsSlot(ref['channel'] as ChannelId) === -1) return fail(`'${ref['channel']}' cannot be locked`);
      if (app.store.get('controls', ref['control'] as ControlId) === undefined) {
        return fail(`Control ${ref['control']} does not exist`);
      }
    }
    return pollEditable(app);
  },
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'channel.toggleLock runs in a transaction');
    const lock =
      args.locked ??
      !args.refs.every((ref) => {
        const control = tx.get('controls', ref.control);
        return control !== undefined && isLocked(control, ref.channel);
      });
    const byControl = new Map<ControlId, ChannelId[]>();
    for (const ref of args.refs) byControl.set(ref.control, [...(byControl.get(ref.control) ?? []), ref.channel]);
    for (const [id, channels] of byControl) {
      const control = tx.get('controls', id);
      if (control === undefined) continue;
      const slots = new Set(channels.map(trsSlot));
      const axes = (group: Axes, offset: number): Axes => [
        slots.has(offset) ? lock : group[0],
        slots.has(offset + 1) ? lock : group[1],
        slots.has(offset + 2) ? lock : group[2],
      ];
      const locked = { t: axes(control.locked.t, 0), r: axes(control.locked.r, 3), s: axes(control.locked.s, 6) };
      if (JSON.stringify(locked) !== JSON.stringify(control.locked)) tx.patch('controls', id, { locked });
    }
  },
});

export const KEY_OPERATORS: readonly AnyOperator[] = [
  keySet,
  keyDeleteAtFrame,
  keyToggleAutoKey,
  channelSetValues,
  channelToggleLock,
];
