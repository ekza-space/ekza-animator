// WP-6 owns this directory. Placeholder registration: a no-op until the panel lands (MVP-SPEC §3 convention 10).
import type { Disposer } from '@ekza-animator/anim-core';
import type { PanelRegistry } from '../types';

export function registerGraphPanel(_registry: PanelRegistry): Disposer {
  return () => {};
}
