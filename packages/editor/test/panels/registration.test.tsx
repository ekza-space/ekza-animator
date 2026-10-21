import { PANEL } from '@ekza-studio/editor-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPanelRegistry, registerBuiltinPanels } from '../../src';
import { registerAttributesPanel } from '../../src/panels/attributes';
import { registerChannelBoxPanel } from '../../src/panels/channel-box';
import { registerClipsPanel } from '../../src/panels/clips';
import { registerOutlinerPanel } from '../../src/panels/outliner';
import { PanelHarness } from '../../src/testing';
import { readSynthetic } from '../render';
import { by, cleanup, mountPlain } from './helpers';

afterEach(cleanup);

describe('WP-9 panel registration (MVP-SPEC §7 WP-9 public API)', () => {
  it.each([
    [registerOutlinerPanel, PANEL.outliner, 'Outliner'],
    [registerClipsPanel, PANEL.clips, 'Clips'],
    [registerChannelBoxPanel, PANEL.channelBox, 'Channel Box'],
    [registerAttributesPanel, PANEL.attributes, 'Attributes'],
  ] as const)('%o registers %s and its disposer removes it', (register, id, title) => {
    const registry = createPanelRegistry();
    const dispose = register(registry);
    expect(registry.get(id)).toMatchObject({ id, kind: id, title, keyScope: id });
    expect(registry.get(id)?.multiInstance).toBeUndefined();
    dispose();
    expect(registry.get(id)).toBeUndefined();
  });

  it('registerBuiltinPanels includes the four data panels', () => {
    const registry = createPanelRegistry();
    const dispose = registerBuiltinPanels(registry);
    const ids = registry.list().map((def) => def.id);
    expect(ids).toEqual(expect.arrayContaining([PANEL.outliner, PANEL.clips, PANEL.channelBox, PANEL.attributes]));
    dispose();
  });
});

describe('the /dev/panels harness mounts every WP-9 panel with the fake app', () => {
  let snapshot: unknown;
  let skeleton: unknown;
  beforeAll(async () => {
    snapshot = await readSynthetic('wave-doc.json');
    skeleton = await readSynthetic('humanoid-skeleton.json');
  });

  // Without the app stylesheet the harness's <main> has no height, so the virtualized outliner shows its tree
  // element but no rows here; the e2e harness route renders them with CSS.
  it.each([
    [PANEL.outliner, 'outliner-tree', ''],
    [PANEL.clips, 'clips-panel', 'wave'],
    [PANEL.channelBox, 'channel-box-panel', 'Select a control'],
    [PANEL.attributes, 'attributes-panel', 'Synthetic Humanoid'],
  ])('%s', async (id, testId, text) => {
    await mountPlain(<PanelHarness snapshot={snapshot} skeleton={skeleton} panel={id} />);
    expect(by(testId).textContent).toContain(text);
    expect(by('dev-panels-title').textContent).toBe(
      { outliner: 'Outliner', clips: 'Clips', channelBox: 'Channel Box', attributes: 'Attributes' }[id],
    );
  });
});
