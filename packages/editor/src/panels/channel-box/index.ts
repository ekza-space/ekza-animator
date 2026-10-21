// WP-9 owns this directory (MVP-SPEC §7 WP-9; registered by panels/index.ts, §3 convention 10). `kit/` holds the
// widgets and kernel adapters the four WP-9 data panels share.
import type { Disposer } from '@ekza-studio/anim-core';
import { PANEL } from '@ekza-studio/editor-core';
import type { PanelDef, PanelRegistry } from '../types';
import { ChannelBoxPanel } from './ChannelBoxPanel';

export const CHANNEL_BOX_PANEL: PanelDef = {
  id: PANEL.channelBox,
  kind: PANEL.channelBox,
  title: 'Channel Box',
  component: ChannelBoxPanel,
  keyScope: PANEL.channelBox,
};

export function registerChannelBoxPanel(registry: PanelRegistry): Disposer {
  return registry.register(CHANNEL_BOX_PANEL);
}
