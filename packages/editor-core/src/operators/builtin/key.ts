// Keying and channel operators (MVP-SPEC §4.9 `key.*`, `channel.*`; §4.11.1 keying, §4.11.2 value edits).
// M2a (M2A-SPEC §5.1 rule 4, §5.12, §5.19; A2): `key.set` keys attribute channels by the `keyAll` rule, keys body
// parts and sets breakdown keys; `key.setTarget` writes the status line's key target.
import { EkzaError } from '@ekza-studio/anim-core';
import {
  type Axes,
  type ChannelId,
  type ChannelValues,
  type ControlId,
  type ControlRecord,
  type ReadView,
  TRS_CHANNELS,
  type TrsChannel,
} from '@ekza-studio/doc';
import {
  attrChannelsOf,
  isAttrChannel,
  isKeyAllChannel,
  isKeyable,
  isLocked,
  newKeyTangents,
  trsSlot,
} from '../../edit/channelMeta';
import { applyChannelEdits } from '../../edit/channels';
import { currentClipFrame } from '../../edit/context';
import { deleteKeys, ensureCurve, writeKeyAt } from '../../edit/keys';
import { redirectedChannelEdit } from '../../evaluation/rigSource';
import { activeClipOf } from '../../evaluation/time';
import { ownerOfControl } from '../../session/location';
import { type ChannelEditResult, type EditorApp, GLOBAL_SCOPE, type KeyPolicy, type KeyTarget } from '../../types';
import { isHumanoidRigOf } from '../../workflows/bodyParts';
import { limbOfControlApp } from '../../workflows/ik';
import { activeClipRecord, curveOf, keyTargetControls, selectedControls } from '../../workflows/targets';
import type { CountResult, KeyChannels } from '../args';
import { type AnyOperator, all, defineOperator, fail, isFiniteNumber, isRecord, OK, optionalArgs } from './define';
import { pollActiveClip, pollClipEdit, pollEditable } from './polls';

const KEY_CHANNELS: readonly KeyChannels[] = ['all', 'translate', 'rotate', 'scale', 'attributes', 'selected'];
const KEY_TARGETS: readonly KeyTarget[] = ['selected', 'bodyPart', 'character'];
const KEY_POLICIES: readonly KeyPolicy[] = ['auto', 'force', 'none'];
const ROTATIONS: readonly TrsChannel[] = ['rx', 'ry', 'rz'];
/** Two keys this close (frames) share a frame (§4.11.1). */
const SAME_FRAME = 1e-6;

interface KeySetArgs {
  readonly channels: KeyChannels;
  readonly target: KeyTarget;
  readonly breakdown: boolean;
}

function keySetArgs(app: EditorApp, args: unknown): KeySetArgs | string {
  const options = optionalArgs(args);
  if (options === null) return 'expects { channels?, target?, breakdown? }';
  const channels = options['channels'] ?? 'all';
  const target = options['target'] ?? app.session.getState().tools.keyTarget;
  const breakdown = options['breakdown'] ?? false;
  if (!KEY_CHANNELS.includes(channels as KeyChannels)) return `unknown channels ${JSON.stringify(channels)}`;
  if (!KEY_TARGETS.includes(target as KeyTarget)) return `unknown target ${JSON.stringify(target)}`;
  if (typeof breakdown !== 'boolean') return 'breakdown must be a boolean';
  return { channels: channels as KeyChannels, target: target as KeyTarget, breakdown };
}

/** The selected Channel Box channels per control (explicit channel choices, §5.1 rule 4). */
function selectedChannelsByControl(app: EditorApp): ReadonlyMap<ControlId, ReadonlySet<ChannelId>> {
  const out = new Map<ControlId, Set<ChannelId>>();
  for (const ref of app.session.getState().selection.channels) {
    let set = out.get(ref.control);
    if (set === undefined) {
      set = new Set();
      out.set(ref.control, set);
    }
    set.add(ref.channel);
  }
  return out;
}

/**
 * Channels `key.set` keys on a control (§4.11.1 rule 2, M2A-SPEC §5.1 rule 4): keyable, unlocked TRS channels of the
 * group (rotations always as a triple); for 'all' and 'attributes' every keyable attribute except `keyAll: false`
 * ones that are not `explicit` (selected Channel Box channels); for 'selected' the explicit channels; translate,
 * rotate and scale never key attributes. TRS channels first (tx…sz), then attributes in `attrs` order.
 */
export function keyChannelsOf(
  app: EditorApp,
  control: ControlRecord,
  which: KeyChannels,
  explicit: ReadonlySet<ChannelId> = selectedChannelsByControl(app).get(control.id) ?? new Set(),
): readonly ChannelId[] {
  const usable = (channel: ChannelId): boolean => isKeyable(control, channel) && !isLocked(control, channel);
  let trs: TrsChannel[];
  switch (which) {
    case 'all':
      trs = [...TRS_CHANNELS];
      break;
    case 'translate':
      trs = ['tx', 'ty', 'tz'];
      break;
    case 'rotate':
      trs = [...ROTATIONS];
      break;
    case 'scale':
      trs = ['sx', 'sy', 'sz'];
      break;
    case 'attributes':
      trs = [];
      break;
    case 'selected':
      trs = TRS_CHANNELS.filter((channel) => explicit.has(channel));
      break;
  }
  const picked = new Set<TrsChannel>(trs.filter(usable));
  if (ROTATIONS.some((channel) => picked.has(channel)))
    for (const channel of ROTATIONS) if (usable(channel)) picked.add(channel);
  const out: ChannelId[] = TRS_CHANNELS.filter((channel) => picked.has(channel));
  if (which === 'all' || which === 'attributes' || which === 'selected') {
    for (const channel of attrChannelsOf(control)) {
      if (!usable(channel)) continue;
      const wanted =
        which === 'selected' ? explicit.has(channel) : isKeyAllChannel(control, channel) || explicit.has(channel);
      if (wanted) out.push(channel);
    }
  }
  return out;
}

/**
 * What one `key.set` keys: per control, its channels. Besides the key target's controls, a selected attribute
 * channel of a limb's IK control counts when a control of that limb is a target (the Channel Box IK/FK proxy row
 * selects `<ikControl>/@ikFk` while an FK control is selected, §5.6).
 */
function keyPlan(app: EditorApp, view: ReadView, args: KeySetArgs): Map<ControlRecord, readonly ChannelId[]> {
  const explicit = selectedChannelsByControl(app);
  const plan = new Map<ControlRecord, readonly ChannelId[]>();
  const targets = new Set<ControlId>();
  for (const id of keyTargetControls(app, args.target, view)) {
    const control = view.get('controls', id);
    if (control === undefined) continue;
    targets.add(id);
    const channels = keyChannelsOf(app, control, args.channels, explicit.get(id) ?? new Set());
    if (channels.length > 0) plan.set(control, channels);
  }
  if (args.channels === 'all' || args.channels === 'attributes' || args.channels === 'selected') {
    for (const [id, channels] of explicit) {
      if (targets.has(id)) continue;
      const control = view.get('controls', id);
      if (control === undefined) continue;
      const limb = limbOfControlApp(app, id);
      if (limb === null || limb.params.ikControl !== id) continue;
      const { fk, pole } = limb.params;
      const limbControls = [fk.upper, fk.mid, fk.end, fk.toes, pole];
      if (!limbControls.some((member) => member !== null && targets.has(member))) continue;
      const proxied = [...channels].filter(
        (channel) => isAttrChannel(channel) && isKeyable(control, channel) && !isLocked(control, channel),
      );
      if (proxied.length > 0) plan.set(control, proxied);
    }
  }
  return plan;
}

const KEY_LABEL: Readonly<Record<KeyChannels, string>> = {
  all: 'Set Key',
  selected: 'Set Key',
  translate: 'Key Translate',
  rotate: 'Key Rotate',
  scale: 'Key Scale',
  attributes: 'Key Attributes',
};

const keySet = defineOperator({
  id: 'key.set',
  label: 'Set Key',
  description:
    'Key the channels of the selected controls (their body parts, or the whole character) at the current frame.',
  category: 'key',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel(args) {
    const options = optionalArgs(args);
    if (options?.['breakdown'] === true) return 'Set Breakdown';
    const channels = (options?.['channels'] ?? 'all') as KeyChannels;
    return KEY_LABEL[channels] ?? 'Set Key';
  },
  poll({ app }, args) {
    const parsed = keySetArgs(app, args);
    if (typeof parsed === 'string') return fail(parsed);
    const base = all(pollEditable(app), pollActiveClip(app));
    if (base !== true) return base;
    if (selectedControls(app).length === 0 && parsed.target !== 'character') return fail('nothing selected');
    if (keyTargetControls(app, parsed.target).length === 0) return fail('nothing selected');
    if (parsed.channels === 'selected' && keyPlan(app, app.store, parsed).size === 0) {
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
    for (const [control, channels] of keyPlan(app, tx, parsed)) {
      const owner = ownerOfControl(tx, control.id);
      const clip = owner === null ? undefined : activeClipOf(tx, state, owner);
      if (clip === undefined) continue;
      const frame = currentClipFrame(app, tx, clip);
      for (const channel of channels) {
        const curve = ensureCurve(app, tx, clip.id, control.id, channel);
        const value = app.evaluation.channelValue(control.id, channel);
        const tangents = newKeyTangents(control, channel, prefs.defaultTangents);
        writeKeyAt(
          app,
          tx,
          curve,
          frame,
          value,
          tangents,
          parsed.breakdown ? { breakdown: true, existing: 'set' } : {},
        );
        count++;
      }
      keyed.set(control.id, new Set(channels));
    }
    if (parsed.target === 'bodyPart') noteGenericBodyPart(app, tx);
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

/** §5.19: on a generic rig, body-part keying keys the selected controls; say so (once per character). */
const toldGeneric = new WeakMap<EditorApp, Set<string>>();
function noteGenericBodyPart(app: EditorApp, view: ReadView): void {
  const generic = selectedControls(app, view).filter((control) => !isHumanoidRigOf(view, control));
  if (generic.length === 0) return;
  const rig = generic[0]?.rig ?? '';
  let told = toldGeneric.get(app);
  if (told === undefined) {
    told = new Set();
    toldGeneric.set(app, told);
  }
  if (told.has(rig)) return;
  told.add(rig);
  app.services.notify.toast({
    kind: 'info',
    text: 'This rig has no body parts: Key › Body Part keyed the selected controls.',
  });
}

const keySetTarget = defineOperator({
  id: 'key.setTarget',
  label: 'Key Target',
  description: 'Key the selected controls, their body parts or the whole character.',
  category: 'key',
  scope: GLOBAL_SCOPE,
  poll(_ctx, args) {
    if (!isRecord(args) || !(KEY_TARGETS as readonly unknown[]).includes(args['target'])) {
      return fail(`expects { target: ${KEY_TARGETS.join(' | ')} }`);
    }
    return OK;
  },
  apply({ app }, args) {
    const state = app.session.getState();
    if (state.tools.keyTarget === args.target) return;
    app.session.setState({ tools: { ...state.tools, keyTarget: args.target } });
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
    const explicit = selectedChannelsByControl(app);
    for (const control of selectedControls(app, tx)) {
      // M2a: attribute keys too, except `keyAll: false` ones that are not selected channels (§5.1 rule 4: a
      // Delete on the IK foot never removes the limb's mode keys).
      const chosen = explicit.get(control.id);
      const attrs = attrChannelsOf(control).filter(
        (channel) => isKeyAllChannel(control, channel) || chosen?.has(channel) === true,
      );
      for (const channel of [...TRS_CHANNELS, ...attrs]) {
        // Locked channels (Channel Box) and locked curves (Graph Editor) keep their keys.
        if (isLocked(control, channel)) continue;
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
    // M6b C7 (§5.17): in Rig & Skin typed values are a test pose (never a key, never the document).
    const test = redirectedChannelEdit(app, 'Test Pose');
    if (test !== null) {
      test.update(args.edits);
      test.commit();
      return { keyed: 0, statics: 0, overrides: new Map(), skipped: [] };
    }
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
      // M2a §5.1 rule 1: attributes cannot be locked; they are skipped (a selection may mix them with TRS rows).
      const channel = ref['channel'] as ChannelId;
      if (trsSlot(channel) === -1 && !isAttrChannel(channel)) return fail(`'${channel}' cannot be locked`);
      if (app.store.get('controls', ref['control'] as ControlId) === undefined) {
        return fail(`Control ${ref['control']} does not exist`);
      }
    }
    if (refs.every((ref) => isAttrChannel((ref as { channel: ChannelId }).channel))) {
      return fail('Attributes cannot be locked');
    }
    return pollEditable(app);
  },
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'channel.toggleLock runs in a transaction');
    const refs = args.refs.filter((ref) => trsSlot(ref.channel) !== -1);
    const lock =
      args.locked ??
      !refs.every((ref) => {
        const control = tx.get('controls', ref.control);
        return control !== undefined && isLocked(control, ref.channel);
      });
    const byControl = new Map<ControlId, ChannelId[]>();
    for (const ref of refs) byControl.set(ref.control, [...(byControl.get(ref.control) ?? []), ref.channel]);
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
  // M2a (M2A-SPEC §5.19)
  keySetTarget,
];
