// Settings › Time (STUDIO-TOUCH-SPEC §10.3 "Scale and units"; ST-T7-UNIT): *Frames · Seconds* for the Thread, its
// chips, an animation's Settings and the Curves axis. Frames by default; the choice is this device's (`./units`). It
// mounts in the Settings sheet's `data-slot="halo.time"` (the Animation section) as its own lazy chunk.
import { Segmented } from '@ekza-studio/ui/touch';
import type { JSX } from 'react';
import { animateWords } from '../i18n/animate';
import type { HaloController } from '../shell/controller';
import { setTimeUnit, type TimeUnit, useTimeUnit } from './units';

const w = animateWords.time;

export default function TimeSettings({ controller }: { readonly controller: HaloController }): JSX.Element {
  const units = useTimeUnit(controller);
  return (
    <div className="flex flex-col gap-1.5 py-2" data-testid="halo-time-row">
      <div className="flex min-h-(--touch-hit) flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="min-w-40 flex-1 font-medium text-fg">{w.label}</span>
        <span className="ml-auto flex shrink-0">
          <Segmented<TimeUnit>
            label={w.label}
            value={units}
            onValueChange={(next) => setTimeUnit(controller, next)}
            items={[
              { value: 'frames', label: w.frames },
              { value: 'seconds', label: w.seconds },
            ]}
            data-testid="halo-settings-time"
          />
        </span>
      </div>
      <p className="text-touch-label text-fg-3">{w.help}</p>
    </div>
  );
}
