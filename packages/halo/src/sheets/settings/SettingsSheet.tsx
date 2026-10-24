// Settings (STUDIO-TOUCH-SPEC §15.14, §16.4, §5.1, §18; T6b): a thin view over `model.ts`. Start in, Input,
// Keyboard, Display, Animation and Import, then Advanced with the rest of the preferences table, each section a
// `<section data-section>` the sheet scrolls to when opened with `args.section` (`args.query`: a preference path to
// show). Every control has a 44 px target, the plain label, Studio Pro's name in grey and its help line, and writes
// through `ctx.run` only.
import { Segmented, SheetGroup, ToggleChip, TouchButton } from '@ekza-studio/ui/touch';
import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react';
import type { HaloSheetContext, HaloSheetProps } from '../../manifest/sheets';
import { HaloSheet, NumberControl, useAppVersion } from '../more/kit';
import {
  type ControlValue,
  proLine,
  type SettingsControl,
  type SettingsLink,
  type SettingsSection,
  settingsSections,
} from './model';

/** Runs a control's write, if any (failures become toasts in `ctx.run`). */
function commit(ctx: HaloSheetContext, control: SettingsControl, value: ControlValue): void {
  const call = control.write(value);
  if (call !== null) void ctx.run(call.op, call.args);
}

/**
 * An enum with long or many choices: the current choice; a tap lists them all as radio buttons in 44 px rows (they
 * stay open while you choose, so arrow keys can walk them; the header folds them).
 */
function ChoiceList(props: {
  readonly control: SettingsControl;
  readonly onChoose: (value: string) => void;
}): JSX.Element {
  const { control } = props;
  const [open, setOpen] = useState(false);
  const current = control.options.find((option) => option.value === control.value);
  return (
    <div className="flex flex-col gap-1">
      <TouchButton
        aria-expanded={open}
        className="justify-between self-stretch"
        onClick={() => setOpen((was) => !was)}
        data-testid={`halo-settings-choice-${control.key}`}
      >
        <span className="truncate">{current?.label ?? String(control.value)}</span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </TouchButton>
      {open ? (
        <fieldset className="flex flex-col">
          <legend className="sr-only">{control.label}</legend>
          {control.options.map((option) => {
            const on = option.value === control.value;
            return (
              <label
                key={option.value}
                className="flex min-h-(--touch-hit) cursor-pointer items-center gap-3 rounded-touch px-3 text-fg-2 active:bg-pressed has-checked:text-fg"
              >
                <input
                  type="radio"
                  name={`halo-settings-${control.key}`}
                  value={option.value}
                  checked={on}
                  className="size-5 shrink-0 accent-accent-fill"
                  onChange={() => props.onChoose(option.value)}
                />
                {option.label}
              </label>
            );
          })}
        </fieldset>
      ) : null}
    </div>
  );
}

function ControlInput(props: {
  readonly ctx: HaloSheetContext;
  readonly control: SettingsControl;
}): JSX.Element | null {
  const { ctx, control } = props;
  const testId = `halo-settings-input-${control.key}`;
  switch (control.presentation) {
    case 'toggle':
      return (
        <ToggleChip
          label={control.value === true ? 'On' : 'Off'}
          aria-label={control.label}
          pressed={control.value === true}
          onPressedChange={(pressed) => commit(ctx, control, pressed)}
          data-testid={testId}
        />
      );
    case 'segments':
      return (
        <Segmented<string>
          label={control.label}
          value={typeof control.value === 'string' ? control.value : ''}
          onValueChange={(next) => commit(ctx, control, next)}
          items={control.options.map((option) => ({ value: option.value, label: option.label }))}
          data-testid={testId}
        />
      );
    case 'number': {
      const range = control.range;
      // The row already names the setting: the chip keeps it as its accessible name and shows only the value.
      return (
        <span className="[&_[role=slider]>span:first-child]:sr-only">
          <NumberControl
            label={control.label}
            value={typeof control.value === 'number' ? control.value : 0}
            step={range?.step ?? 0.01}
            {...(control.unit === null ? {} : { unit: control.unit })}
            {...(range === null ? {} : { min: range.min, max: range.max })}
            {...(control.proName === null ? {} : { proName: control.proName })}
            onCommit={(next) => commit(ctx, control, next)}
            testId={testId}
          />
        </span>
      );
    }
    case 'list':
    case 'none':
      return null;
  }
}

function ControlRow(props: {
  readonly ctx: HaloSheetContext;
  readonly control: SettingsControl;
  readonly highlight: boolean;
}): JSX.Element {
  const { ctx, control } = props;
  const pro = proLine(control);
  const below = control.presentation === 'list';
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-touch px-2.5 py-2 ${props.highlight ? 'ring-2 ring-accent' : ''}`}
      data-testid="halo-settings-control"
      data-path={control.path ?? undefined}
      data-op={control.op ?? undefined}
    >
      {/* Wraps: a control wider than the room left by the label (segments, an open numpad) drops under it. */}
      <div className="flex min-h-(--touch-hit) flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex min-w-40 flex-1 flex-col">
          <span className="font-medium text-fg">{control.label}</span>
          {pro === '' ? null : <span className="text-touch-label text-fg-3">{pro}</span>}
        </span>
        {below ? null : (
          <span className="ml-auto flex shrink-0">
            <ControlInput ctx={ctx} control={control} />
          </span>
        )}
      </div>
      {below ? <ChoiceList control={control} onChoose={(value) => commit(ctx, control, value)} /> : null}
      {control.help === null ? null : <p className="text-touch-label text-fg-3">{control.help}</p>}
      {control.disabledReason === null ? null : (
        <p className="text-touch-label text-fg-2" data-testid="halo-settings-reason">
          {control.disabledReason}
        </p>
      )}
      {control.note === null ? null : (
        <p className="text-touch-label text-fg-2" data-testid="halo-settings-note">
          {control.note}
        </p>
      )}
    </div>
  );
}

function LinkView(props: { readonly ctx: HaloSheetContext; readonly link: SettingsLink }): JSX.Element {
  const { ctx, link } = props;
  if (link.kind === 'href') {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="noopener"
        className="inline-flex min-h-(--touch-hit) items-center self-start rounded-touch px-2.5 font-medium text-accent-text underline-offset-4 hover:underline"
        data-testid="halo-settings-link"
      >
        {link.label}
      </a>
    );
  }
  return (
    <TouchButton
      variant="ghost"
      className="self-start text-accent-text"
      onClick={() => {
        if (link.kind === 'sheet') ctx.open(link.sheet, { section: link.section });
        else ctx.setStage(link.stage);
      }}
      data-testid="halo-settings-link"
    >
      {link.label}
    </TouchButton>
  );
}

function SectionView(props: {
  readonly ctx: HaloSheetContext;
  readonly section: SettingsSection;
  readonly highlight: string | null;
  readonly children?: ReactNode;
}): JSX.Element {
  const { ctx, section } = props;
  return (
    <section
      data-section={section.id}
      aria-label={section.label}
      data-testid={`halo-settings-section-${section.id}`}
      className="scroll-mt-2"
    >
      <SheetGroup>{section.label}</SheetGroup>
      {section.intro === null ? null : <p className="px-2.5 pb-1 text-touch-label text-fg-2">{section.intro}</p>}
      {section.slot === null ? null : (
        // SLOT (§5.1, §18): the frame's `halo.input` rows mount here (`ctx.renderSlot`, T6a's `input/InputSettings`) —
        // the Finger / Pencil / Mouse routing, *Halo opens on*, *Reduce gestures*, quick pinch to frame all, the
        // Thumb key and handedness. They are Halo preferences and never write Studio Pro's `navProfile`. The Animation
        // section's `halo.time` slot holds Settings › Time (T7's `thread/TimeSettings`, ST-T7-UNIT).
        <div
          data-slot={section.slot}
          data-testid={section.slot === 'halo.input' ? 'halo-settings-input-slot' : 'halo-settings-time-slot'}
          className="px-2.5 pb-1"
        >
          {ctx.renderSlot?.(section.slot) ??
            (section.slot !== 'halo.input' ? null : (
              <p className="text-touch-label text-fg-2">
                Touch and Pencil: until a Pencil is used, a finger changes what is selected and orbits elsewhere; after
                that the Pencil edits and fingers move the view.
              </p>
            ))}
        </div>
      )}
      {section.controls.map((control) => (
        <ControlRow key={control.key} ctx={ctx} control={control} highlight={control.path === props.highlight} />
      ))}
      {section.links.map((link) => (
        <LinkView key={link.label} ctx={ctx} link={link} />
      ))}
      {props.children}
    </section>
  );
}

/** The sections the jump row offers (Advanced's groups are reached through it). */
const JUMPS = ['startIn', 'input', 'keyboard', 'display', 'animation', 'import', 'advanced'];

export default function SettingsSheet({ ctx, args }: HaloSheetProps): JSX.Element {
  const app = ctx.host.app;
  useAppVersion(app);
  const root = useRef<HTMLDivElement>(null);
  const sections = settingsSections(app);
  const highlight = args?.query ?? null;
  const target = args?.query === undefined ? args?.section : undefined;

  const scrollTo = (selector: string): void => {
    root.current?.querySelector(selector)?.scrollIntoView({ block: 'start' });
  };
  useEffect(() => {
    if (highlight !== null) {
      root.current?.querySelector(`[data-path="${CSS.escape(highlight)}"]`)?.scrollIntoView({ block: 'center' });
    } else if (target !== undefined) {
      root.current?.querySelector(`[data-section="${CSS.escape(target)}"]`)?.scrollIntoView({ block: 'start' });
    }
  }, [highlight, target]);

  const top = sections.filter((section) => section.page === 'settings' && section.id !== 'advanced');
  const advanced = sections.find((section) => section.id === 'advanced');
  const groups = sections.filter((section) => section.page === 'advanced');
  return (
    <HaloSheet
      ctx={ctx}
      id="settings"
      title="Settings"
      description="Both layouts read these; Studio Pro's names are in grey"
    >
      <div ref={root} data-testid="halo-settings">
        <nav aria-label="Settings sections" className="flex flex-wrap gap-1 px-1 pt-1">
          {JUMPS.map((id) => {
            const section = sections.find((s) => s.id === id);
            return section === undefined ? null : (
              <TouchButton
                key={id}
                variant="ghost"
                onClick={() => scrollTo(`[data-section="${id}"]`)}
                data-testid={`halo-settings-jump-${id}`}
              >
                {section.label}
              </TouchButton>
            );
          })}
        </nav>
        {top.map((section) => (
          <SectionView key={section.id} ctx={ctx} section={section} highlight={highlight} />
        ))}
        {advanced === undefined ? null : (
          <SectionView ctx={ctx} section={advanced} highlight={highlight}>
            {groups.map((section) => (
              <SectionView key={section.id} ctx={ctx} section={section} highlight={highlight} />
            ))}
          </SectionView>
        )}
      </div>
    </HaloSheet>
  );
}
