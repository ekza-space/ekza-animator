// The Timeline panel (MVP-SPEC §7 WP-6t): the time slider with the current-frame field, and below it the range
// slider, clip selector, fps menu, transport, loop and speed, auto-key toggle and the scene-time readout.
import type { JSX } from 'react';
import type { PanelProps } from '../types';
import { ClipSelect, FpsMenu } from './ClipControls';
import { CurrentFrameField, SceneTimeReadout } from './fields';
import { AutoKeyToggle, LoopSpeedControls, PlaybackControls } from './PlaybackControls';
import { RangeSlider } from './RangeSlider';
import { useActiveClip } from './state';
import { TimeSliderView } from './TimeSliderView';

const divider = <span aria-hidden="true" className="h-4 w-px shrink-0 bg-line" />;

export function TimelinePanel(props: PanelProps): JSX.Element {
  const { app } = props;
  const { clip, clips, sceneFps } = useActiveClip();
  return (
    <div className="flex w-full select-none flex-col bg-panel text-xs text-fg" data-testid="timeline-panel">
      <div className="flex h-[30px] shrink-0 items-stretch gap-1 border-b border-line">
        <div className="relative min-w-0 flex-1">
          <TimeSliderView app={app} />
        </div>
        <div className="flex shrink-0 items-center pr-1">
          <CurrentFrameField app={app} />
        </div>
      </div>
      <div className="flex h-[28px] shrink-0 items-center gap-2 overflow-hidden px-1">
        <RangeSlider app={app} clip={clip} sceneFps={sceneFps} />
        {divider}
        <ClipSelect app={app} clip={clip} clips={clips} />
        <FpsMenu app={app} clip={clip} />
        {divider}
        <PlaybackControls app={app} />
        {divider}
        <LoopSpeedControls app={app} />
        {divider}
        <AutoKeyToggle app={app} />
        <SceneTimeReadout app={app} />
      </div>
    </div>
  );
}
