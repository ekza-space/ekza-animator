// Graph Editor channel list (research 09 §4.7): character › control › channel, with X/Y/Z swatches, the curve of
// each channel in the clip's base layer, a name filter and "only animated". Channels are named and ordered like the
// Channel Box's rows (§5.1 rule 5).
import {
  type ChannelId,
  type CharacterId,
  type ClipId,
  type ControlId,
  type ControlRecord,
  type CurveRecord,
  TRS_CHANNELS,
} from '@ekza-studio/doc';
import { type EditorApp, sortChannelsForDisplay } from '@ekza-studio/editor-core';
import type { ChannelTreeNode } from '../types';
import { CHANNEL_COLORS, channelColor, channelLabel } from './colors';

export { CHANNEL_COLORS } from './colors';

const AXES = ['x', 'y', 'z'] as const;

function keyableChannels(control: ControlRecord): ChannelId[] {
  const channels: ChannelId[] = [];
  for (const channel of TRS_CHANNELS) {
    const group = channel[0] === 't' ? control.keyable.t : channel[0] === 'r' ? control.keyable.r : control.keyable.s;
    const axis = AXES.indexOf(channel[1] as 'x' | 'y' | 'z');
    if (group[axis] === true) channels.push(channel);
  }
  return channels;
}

export function buildChannelTree(
  app: EditorApp,
  opts: {
    readonly clip: ClipId | null;
    readonly controls: readonly ControlId[];
    readonly filter?: string;
    readonly onlyAnimated?: boolean;
  },
): ChannelTreeNode[] {
  const { store } = app;
  const filter = (opts.filter ?? '').trim().toLowerCase();
  const base = opts.clip === null ? undefined : store.query.baseLayer(opts.clip);
  const characters = new Map<CharacterId, { name: string; controls: ChannelTreeNode[] }>();
  const seen = new Set<ControlId>();

  for (const controlId of opts.controls) {
    if (seen.has(controlId)) continue;
    seen.add(controlId);
    const control = store.get('controls', controlId);
    const rig = control === undefined ? undefined : store.get('rigs', control.rig);
    const character = rig === undefined ? undefined : store.get('characters', rig.character);
    if (control === undefined || character === undefined) continue;

    const curves = new Map<ChannelId, CurveRecord>();
    if (opts.clip !== null && base !== undefined) {
      for (const curve of store.query.curvesOfControl(opts.clip, controlId)) {
        if (curve.layer !== base.id) continue;
        const canonical = store.query.curveFor(opts.clip, base.id, controlId, curve.channel);
        if (canonical !== undefined) curves.set(curve.channel, canonical);
      }
    }
    // The Channel Box's order and names (§5.1 rule 5, M2A-INT-35): TRS, then attributes in `attrs` order, IK/FK last.
    const channels = sortChannelsForDisplay(control, new Set([...keyableChannels(control), ...curves.keys()]));
    const controlMatches =
      filter === '' || control.name.toLowerCase().includes(filter) || control.key.toLowerCase().includes(filter);
    const children: ChannelTreeNode[] = [];
    for (const channel of channels) {
      const curve = curves.get(channel);
      if (opts.onlyAnimated === true && (curve === undefined || store.query.keysOfCurve(curve.id).length === 0)) {
        continue;
      }
      const label = channelLabel(channel, control);
      if (!controlMatches && !label.toLowerCase().includes(filter) && !channel.toLowerCase().includes(filter)) {
        continue;
      }
      children.push({
        id: `${controlId}/${channel}`,
        kind: 'channel',
        label,
        control: controlId,
        channel,
        ...(curve === undefined ? {} : { curve: curve.id }),
        color: channelColor(channel),
        children: [],
      });
    }
    if (children.length === 0 && (opts.onlyAnimated === true || !controlMatches)) continue;
    let group = characters.get(character.id);
    if (group === undefined) {
      group = { name: character.name, controls: [] };
      characters.set(character.id, group);
    }
    group.controls.push({
      id: controlId,
      kind: 'control',
      label: control.name,
      control: controlId,
      color: CHANNEL_COLORS.other,
      children,
    });
  }

  return [...characters].map(([id, group]) => ({
    id,
    kind: 'character',
    label: group.name,
    color: CHANNEL_COLORS.other,
    children: group.controls,
  }));
}

/** Depth-first channel nodes of a tree. */
export function channelNodes(tree: readonly ChannelTreeNode[]): ChannelTreeNode[] {
  const out: ChannelTreeNode[] = [];
  const visit = (node: ChannelTreeNode): void => {
    if (node.kind === 'channel') out.push(node);
    for (const child of node.children) visit(child);
  };
  for (const node of tree) visit(node);
  return out;
}
