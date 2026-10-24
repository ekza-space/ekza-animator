// The selected keys' numbers as Echo chips (STUDIO-TOUCH-SPEC §10.5 Fields, §5.6; T10): ⟨Time⟩ ⟨Value⟩ ⟨In⟩ ⟨Out⟩,
// and ⟨In weight⟩ ⟨Out weight⟩ on weighted curves — Pro's Graph Editor fields with Pro's numbers, units and signs
// (§10.1 P14). Time reads in Settings › Time's unit (frames by default, ST-T7-UNIT) and always lands on whole frames.
// Scrub a chip (one `graph.keys.setFields` run on release), or tap it for the numpad. Where the selected keys differ
// the chip reads "±": a scrub moves every key by the same amount (`relative`), a typed number sets them all.
import type { Fps } from '@ekza-studio/anim-core';
import { ValueChip } from '@ekza-studio/ui/touch';
import { type JSX, lazy, Suspense, useState } from 'react';
import { animateWords } from '../../i18n/animate';
import type { HaloController } from '../../shell/controller';
import { framesFromShown, shownTime } from '../../stages/animate/TimeChip';
import type { TimeUnit } from '../units';
import type { KeyNumbers } from './model';

const NumpadPanel = lazy(() => import('../../chips/NumpadPanel'));

const w = animateWords.curves;

type Field = 'frame' | 'value' | 'inAngleDeg' | 'outAngleDeg' | 'inWeight' | 'outWeight';

interface ChipDef {
  readonly field: Field;
  readonly label: string;
  readonly value: number | null;
  readonly unit: string;
  readonly step: number;
  readonly testId: string;
}

export function KeyChips({
  controller,
  numbers,
  units,
}: {
  readonly controller: HaloController;
  readonly numbers: KeyNumbers;
  readonly units: TimeUnit;
}): JSX.Element | null {
  const { ctx } = controller;
  const [numpad, setNumpad] = useState<Field | null>(null);
  if (numbers.count === 0) return null;
  const fps: Fps = numbers.fps ?? { num: 30, den: 1 };
  const count = (): void => ctx.store.set((s) => ({ touches: s.touches + 1 }));
  const chips: ChipDef[] = [
    {
      field: 'frame',
      label: w.time,
      value: numbers.frame === null ? null : shownTime(numbers.frame, fps, units),
      unit: units === 'frames' ? 'f' : 's',
      step: units === 'frames' ? 1 : 0.01,
      testId: 'halo-curves-time',
    },
    {
      field: 'value',
      label: w.value,
      value: numbers.value,
      unit: numbers.unit,
      step: numbers.unit === '°' ? 0.1 : 0.001,
      testId: 'halo-curves-value',
    },
    { field: 'inAngleDeg', label: w.inAngle, value: numbers.inAngle, unit: '°', step: 0.1, testId: 'halo-curves-in' },
    {
      field: 'outAngleDeg',
      label: w.outAngle,
      value: numbers.outAngle,
      unit: '°',
      step: 0.1,
      testId: 'halo-curves-out',
    },
    ...(numbers.weighted
      ? [
          {
            field: 'inWeight',
            label: w.inWeight,
            value: numbers.inWeight,
            unit: '',
            step: 0.01,
            testId: 'halo-curves-in-weight',
          },
          {
            field: 'outWeight',
            label: w.outWeight,
            value: numbers.outWeight,
            unit: '',
            step: 0.01,
            testId: 'halo-curves-out-weight',
          },
        ]
      : []),
  ] as ChipDef[];
  /** The operator's field value for a shown one: whole frames for time (Settings › Time), the rest as shown. */
  const stored = (field: Field, shown: number): number =>
    field === 'frame' ? framesFromShown(shown, fps, units) : shown;
  const setField = (field: Field, value: number, relative: boolean): void => {
    void ctx.run('graph.keys.setFields', { [field]: value, ...(relative ? { relative: true } : {}) });
  };
  return (
    <fieldset
      className="m-0 flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-0 p-0"
      aria-label={w.fields}
      data-testid="halo-curves-fields"
    >
      {chips.map((chip) => {
        const differ = chip.value === null;
        const shown = chip.value ?? 0;
        return (
          <span key={chip.field} className="relative inline-flex">
            <ValueChip
              label={differ ? w.differ(chip.label) : chip.label}
              value={shown}
              step={chip.step}
              unit={chip.unit}
              data-testid={chip.testId}
              onCommit={(next) => {
                count();
                // a scrub of keys that differ moves them all by the same amount
                if (differ) setField(chip.field, stored(chip.field, next) - stored(chip.field, 0), true);
                else if (next !== shown) setField(chip.field, stored(chip.field, next), false);
              }}
              onOpenNumpad={() => {
                count();
                setNumpad(chip.field);
              }}
            />
            {numpad === chip.field ? (
              <Suspense fallback={null}>
                <NumpadPanel
                  label={chip.label}
                  value={shown}
                  unit={chip.unit}
                  data-testid={`${chip.testId}-numpad`}
                  style={{ position: 'absolute', left: 0, bottom: '100%', marginBottom: 8 }}
                  onDone={(value) => {
                    setNumpad(null);
                    // a typed number sets every selected key (Pro's fields do the same)
                    setField(chip.field, stored(chip.field, value), false);
                  }}
                  onCancel={() => setNumpad(null)}
                />
              </Suspense>
            ) : null}
          </span>
        );
      })}
    </fieldset>
  );
}
