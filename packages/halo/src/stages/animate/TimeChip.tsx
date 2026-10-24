// A time value as a chip (STUDIO-TOUCH-SPEC §5.6, §10.3; ST-T7-UNIT): whole frames by default, seconds when Settings ›
// Time says so. Scrub it, or tap for the numpad (its own lazy chunk, the Echo chips' `NumpadPanel`); every commit hands
// back whole frames, since keys and ranges always land on whole frames.
import type { Fps } from '@ekza-studio/anim-core';
import { ValueChip } from '@ekza-studio/ui/touch';
import { type JSX, lazy, Suspense, useState } from 'react';
import type { TimeUnit } from '../../thread/units';
import { framesOf, secondsOf } from './model';

const NumpadPanel = lazy(() => import('../../chips/NumpadPanel'));

/** A frame count shown in `units`, and back (whole frames). */
export function shownTime(frames: number, fps: Fps, units: TimeUnit): number {
  return units === 'frames' ? Math.round(frames) : Number(secondsOf(frames, fps).toFixed(2));
}

export function framesFromShown(value: number, fps: Fps, units: TimeUnit): number {
  return units === 'frames' ? Math.round(value) : framesOf(value, fps);
}

export function TimeChip(props: {
  readonly label: string;
  readonly frames: number;
  readonly fps: Fps;
  readonly units: TimeUnit;
  readonly min: number;
  readonly max: number;
  readonly onCommit: (frames: number) => void;
  readonly testId: string;
}): JSX.Element {
  const { fps, units } = props;
  const [numpad, setNumpad] = useState(false);
  const unit = units === 'frames' ? 'f' : 's';
  const range = { min: shownTime(props.min, fps, units), max: shownTime(props.max, fps, units) };
  const commit = (value: number): void => {
    const frames = Math.min(props.max, Math.max(props.min, framesFromShown(value, fps, units)));
    if (frames !== props.frames) props.onCommit(frames);
  };
  return (
    <span className="relative inline-flex">
      <ValueChip
        label={props.label}
        value={shownTime(props.frames, fps, units)}
        step={units === 'frames' ? 1 : 0.01}
        unit={unit}
        {...range}
        data-testid={props.testId}
        onCommit={commit}
        onOpenNumpad={() => setNumpad(true)}
      />
      {numpad ? (
        <Suspense fallback={null}>
          <NumpadPanel
            label={props.label}
            value={shownTime(props.frames, fps, units)}
            unit={unit}
            {...range}
            data-testid={`${props.testId}-numpad`}
            style={{ position: 'absolute', left: 0, bottom: '100%', marginBottom: 8 }}
            onDone={(value) => {
              setNumpad(false);
              commit(value);
            }}
            onCancel={() => setNumpad(false)}
          />
        </Suspense>
      ) : null}
    </span>
  );
}
