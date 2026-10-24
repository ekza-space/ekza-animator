// WP-9 owns this directory (MVP-SPEC §7 WP-9; registered by panels/index.ts, §3 convention 10). `kit/` holds the
// widgets and kernel adapters the four WP-9 data panels share.
import type { Disposer } from '@ekza-studio/anim-core';
import { PANEL } from '@ekza-studio/editor-core';
import type { PanelDef, PanelRegistry } from '../types';
import { ChannelsPanel } from './ChannelsPanel';

export const CHANNELS_PANEL: PanelDef = {
  id: PANEL.channels,
  kind: PANEL.channels,
  title: 'Channels',
  component: ChannelsPanel,
  keyScope: PANEL.channels,
};

export function registerChannelsPanel(registry: PanelRegistry): Disposer {
  return registry.register(CHANNELS_PANEL);
}
