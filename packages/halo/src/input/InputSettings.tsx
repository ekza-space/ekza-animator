// Settings › Input, Halo's own rows (STUDIO-TOUCH-SPEC §4.5, §5.1, §18; ST-T6A-3): who edits (shared, Pencil edits,
// Pencil only), when the Halo opens, *Reduce gestures* (AS-ST-9), the quick pinch, the Thumb key and the hand you
// draw with. They mount in the Settings sheet's `data-slot="halo.input"` (T6b's sheet, the frame's `renderSlot`) and
// write `halo.input` — this device's record in localStorage — never Studio Pro's preferences. A lazy chunk with the
// sheet.
import { Segmented, ToggleChip } from '@ekza-studio/ui/touch';
import type { JSX, ReactNode } from 'react';
import { en } from '../i18n/en';
import { type HaloInput, type HaloStore, useHaloStore } from '../shell/store';

export interface InputSettingsProps {
  readonly store: HaloStore;
  /** Writes the device's `halo.input` record (the store, then localStorage). */
  readonly setInput: (patch: Partial<HaloInput>) => void;
}

function Row(props: { readonly label: string; readonly help?: string; readonly children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 py-2" data-testid="halo-input-row">
      <div className="flex min-h-(--touch-hit) flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="min-w-40 flex-1 font-medium text-fg">{props.label}</span>
        <span className="ml-auto flex shrink-0">{props.children}</span>
      </div>
      {props.help === undefined ? null : <p className="text-touch-label text-fg-3">{props.help}</p>}
    </div>
  );
}

export default function InputSettings({ store, setInput }: InputSettingsProps): JSX.Element {
  const input = useHaloStore(store, (s) => s.input);
  const t = en.input;
  const toggle = (key: 'reduceGestures' | 'quickPinch', label: string, testId: string): JSX.Element => (
    <ToggleChip
      label={input[key] ? t.on : t.off}
      aria-label={label}
      pressed={input[key]}
      onPressedChange={(pressed) => setInput({ [key]: pressed })}
      data-testid={testId}
    />
  );
  return (
    <div data-testid="halo-input-settings">
      <Row label={t.routing} help={t.routingHelp}>
        <Segmented<HaloInput['routing']>
          label={t.routing}
          value={input.routing}
          onValueChange={(routing) => setInput({ routing })}
          items={[
            { value: 'shared', label: t.shared },
            { value: 'pencilEdits', label: t.pencilEdits },
            { value: 'pencilOnly', label: t.pencilOnly },
          ]}
          data-testid="halo-input-routing"
        />
      </Row>
      <Row label={t.opensOn} help={t.opensOnHelp}>
        <Segmented<HaloInput['haloOpensOn']>
          label={t.opensOn}
          value={input.haloOpensOn}
          onValueChange={(haloOpensOn) => setInput({ haloOpensOn })}
          items={[
            { value: 'auto', label: t.auto },
            { value: 'tap', label: t.tap },
            { value: 'secondary', label: t.secondary },
          ]}
          data-testid="halo-input-opens-on"
        />
      </Row>
      <Row label={t.reduce} help={t.reduceHelp}>
        {toggle('reduceGestures', t.reduce, 'halo-input-reduce')}
      </Row>
      <Row label={t.quickPinch}>{toggle('quickPinch', t.quickPinch, 'halo-input-quick-pinch')}</Row>
      <Row label={t.thumbKey}>
        <Segmented<HaloInput['thumbKey']>
          label={t.thumbKey}
          value={input.thumbKey}
          onValueChange={(thumbKey) => setInput({ thumbKey })}
          items={[
            { value: 'auto', label: t.thumbAuto },
            { value: 'always', label: t.thumbAlways },
            { value: 'never', label: t.thumbNever },
          ]}
          data-testid="halo-input-thumb"
        />
      </Row>
      <Row label={t.handedness}>
        <Segmented<HaloInput['handedness']>
          label={t.handedness}
          value={input.handedness}
          onValueChange={(handedness) => setInput({ handedness })}
          items={[
            { value: 'right', label: t.right },
            { value: 'left', label: t.left },
          ]}
          data-testid="halo-input-hand"
        />
      </Row>
    </div>
  );
}
