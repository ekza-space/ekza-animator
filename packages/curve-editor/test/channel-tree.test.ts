import type { ControlId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { buildChannelTree, CHANNEL_COLORS, channelColor, channelLabel, channelNodes } from '../src';
import { addCurve, key, WAVE, waveApp } from './support/app';

const UPPER_ARM = 'rig_SyntheticWave001:fk.upperArm.L' as ControlId;
const ROOT = 'rig_SyntheticWave001:root' as ControlId;

describe('buildChannelTree', () => {
  it('lists character › control › keyable channels with X/Y/Z swatches and the clip curves', async () => {
    const app = await waveApp();
    const tree = buildChannelTree(app, { clip: WAVE.clip, controls: [WAVE.control] });
    expect(tree).toHaveLength(1);
    const [character] = tree;
    expect(character?.kind).toBe('character');
    expect(character?.id).toBe(WAVE.character);
    expect(character?.label).toBe('Synthetic Humanoid');
    expect(character?.children.map((node) => [node.kind, node.id, node.label])).toEqual([
      ['control', WAVE.control, 'L Lower Arm'],
    ]);
    const channels = channelNodes(tree);
    expect(channels.map((node) => node.channel)).toEqual(['rx', 'ry', 'rz']);
    const rz = channels.find((node) => node.channel === 'rz');
    expect(rz).toMatchObject({
      id: `${WAVE.control}/rz`,
      kind: 'channel',
      label: 'Rotate Z',
      control: WAVE.control,
      curve: WAVE.curve,
      color: CHANNEL_COLORS.z,
      children: [],
    });
    expect(channels.find((node) => node.channel === 'rx')?.curve).toBeUndefined();
    expect(channels.find((node) => node.channel === 'rx')?.color).toBe(CHANNEL_COLORS.x);
    app.dispose();
  });

  it('keeps the given control order, skips unknown and duplicate controls, adds custom channels with curves', async () => {
    const app = await waveApp();
    addCurve(app, { control: UPPER_ARM, channel: '@curl', keys: [key(0, 1)] });
    const tree = buildChannelTree(app, {
      clip: WAVE.clip,
      controls: [UPPER_ARM, 'rig_SyntheticWave001:nope' as ControlId, WAVE.control, UPPER_ARM, ROOT],
    });
    expect(tree[0]?.children.map((node) => node.id)).toEqual([UPPER_ARM, WAVE.control, ROOT]);
    const upper = tree[0]?.children[0];
    expect(upper?.children.map((node) => node.channel)).toEqual(['rx', 'ry', 'rz', '@curl']);
    expect(upper?.children.at(-1)).toMatchObject({ label: 'curl', color: CHANNEL_COLORS.other });
    expect(tree[0]?.children[2]?.children.map((node) => node.channel)).toEqual(['tx', 'ty', 'tz', 'rx', 'ry', 'rz']);
    app.dispose();
  });

  it('"only animated" keeps channels whose curve has keys, and drops controls without any', async () => {
    const app = await waveApp();
    addCurve(app, { control: UPPER_ARM, channel: 'ry', keys: [] });
    const tree = buildChannelTree(app, {
      clip: WAVE.clip,
      controls: [UPPER_ARM, WAVE.control],
      onlyAnimated: true,
    });
    expect(channelNodes(tree).map((node) => node.id)).toEqual([`${WAVE.control}/rz`]);
    expect(tree[0]?.children.map((node) => node.id)).toEqual([WAVE.control]);
    app.dispose();
  });

  it('filters by control name or template key (all channels) and by channel label', async () => {
    const app = await waveApp();
    const controls = [UPPER_ARM, WAVE.control, ROOT];
    const byName = buildChannelTree(app, { clip: WAVE.clip, controls, filter: 'lower' });
    expect(byName[0]?.children.map((node) => node.id)).toEqual([WAVE.control]);
    expect(channelNodes(byName)).toHaveLength(3);
    const byKey = buildChannelTree(app, { clip: WAVE.clip, controls, filter: 'FK.UPPERARM' });
    expect(byKey[0]?.children.map((node) => node.id)).toEqual([UPPER_ARM]);
    const byChannel = buildChannelTree(app, { clip: WAVE.clip, controls, filter: 'translate' });
    expect(channelNodes(byChannel).map((node) => node.id)).toEqual([`${ROOT}/tx`, `${ROOT}/ty`, `${ROOT}/tz`]);
    expect(buildChannelTree(app, { clip: WAVE.clip, controls, filter: 'zzz' })).toEqual([]);
    app.dispose();
  });

  it('works without a clip (no curves) and with no controls', async () => {
    const app = await waveApp();
    expect(buildChannelTree(app, { clip: null, controls: [] })).toEqual([]);
    const tree = buildChannelTree(app, { clip: null, controls: [WAVE.control] });
    expect(channelNodes(tree).every((node) => node.curve === undefined)).toBe(true);
    app.dispose();
  });

  it('names and colours channels', () => {
    expect(channelLabel('tx')).toBe('Translate X');
    expect(channelLabel('ry')).toBe('Rotate Y');
    expect(channelLabel('sz')).toBe('Scale Z');
    expect(channelLabel('@blink')).toBe('blink');
    expect(channelColor('ty')).toBe(CHANNEL_COLORS.y);
    expect(channelColor('sz')).toBe(CHANNEL_COLORS.z);
    expect(channelColor('@x')).toBe(CHANNEL_COLORS.other);
  });
});
