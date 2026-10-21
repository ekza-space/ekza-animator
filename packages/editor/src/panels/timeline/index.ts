// WP-6t: the Timeline panel (time slider, range slider, playback row). Registered by registerBuiltinPanels.
import type { Disposer } from '@ekza-studio/anim-core';
import { PANEL } from '@ekza-studio/editor-core';
import type { PanelRegistry } from '../types';
import { TimelinePanel } from './TimelinePanel';

export {
  focusedTimeSlider,
  screenOfTimelineBand,
  screenOfTimelineFrame,
  screenOfTimelineTick,
  timelineTicksOf,
} from './host';

export const TIMELINE_PANEL_ID = 'timeline';

export function registerTimelinePanel(registry: PanelRegistry): Disposer {
  return registry.register({
    id: TIMELINE_PANEL_ID,
    kind: PANEL.timeline,
    title: 'Time Slider',
    component: TimelinePanel,
    keyScope: PANEL.timeline,
  });
}
