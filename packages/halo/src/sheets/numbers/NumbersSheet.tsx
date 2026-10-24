// Numbers, the Inspector (STUDIO-TOUCH-SPEC §6.6; T6b): the selected noun's properties by section, each value with
// Studio Pro's number, unit and sign and the Pro name in grey. Numbers are scrub chips (drag sideways; farther away
// vertically for finer steps) with the numpad on a tap; channel rows carry their lock and key state, and a long-press
// (or the row's ⋯) gives Key this channel · Lock / Unlock · Reset to default. Every edit is one operator run.
import { Segmented, ToggleChip, TouchButton, TouchIconButton, useLongPress } from '@ekza-studio/ui/touch';
import { type JSX, useEffect, useRef, useState } from 'react';
import type { HaloSheetContext, HaloSheetProps } from '../../manifest/sheets';
import { FieldRow, HaloSheet, NumberControl, SheetGroup, useAppVersion } from '../more/kit';
import { type NumbersField, type NumbersSection, numbersSections, numbersTitle, type OperatorCall } from './model';

function runCall(ctx: HaloSheetContext, call: OperatorCall & { readonly then?: OperatorCall }): void {
  void ctx.run(call.op, call.args).then((result) => {
    if (result.status === 'finished' && call.then !== undefined) void ctx.run(call.then.op, call.then.args);
  });
}

function TextField(props: { readonly field: NumbersField; readonly onCommit: (value: string) => void }): JSX.Element {
  const [draft, setDraft] = useState(String(props.field.value));
  useEffect(() => setDraft(String(props.field.value)), [props.field.value]);
  return (
    <input
      type="text"
      value={draft}
      aria-label={props.field.label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim() !== '' && draft !== props.field.value) props.onCommit(draft.trim());
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      className="min-h-(--touch-hit) w-44 rounded-touch border border-line bg-field px-3 text-[16px] text-fg"
      data-testid={`halo-numbers-text-${props.field.id}`}
    />
  );
}

function FieldControl(props: { readonly ctx: HaloSheetContext; readonly field: NumbersField }): JSX.Element {
  const { ctx, field } = props;
  const write = field.write;
  if (field.kind === 'readonly' || write === null) {
    return (
      <span className="text-touch-value text-fg-2" data-testid={`halo-numbers-value-${field.id}`}>
        {typeof field.value === 'number' ? `${field.value}${field.unit ?? ''}` : String(field.value)}
        {field.locked === true ? ' · locked' : ''}
      </span>
    );
  }
  if (field.kind === 'bool') {
    return (
      <ToggleChip
        label={field.value === true ? 'On' : 'Off'}
        pressed={field.value === true}
        onPressedChange={(pressed) => runCall(ctx, write(pressed))}
        data-testid={`halo-numbers-toggle-${field.id}`}
      />
    );
  }
  if (field.kind === 'enum') {
    return (
      <Segmented<string>
        label={field.label}
        value={String(field.value)}
        onValueChange={(value) => runCall(ctx, write(value))}
        items={(field.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
        data-testid={`halo-numbers-enum-${field.id}`}
      />
    );
  }
  if (field.kind === 'text') return <TextField field={field} onCommit={(value) => runCall(ctx, write(value))} />;
  return (
    <NumberControl
      label={field.label}
      value={Number(field.value)}
      step={field.step ?? 0.01}
      {...(field.unit === undefined || field.unit === '' ? {} : { unit: field.unit })}
      {...(field.min === undefined ? {} : { min: field.min })}
      {...(field.max === undefined ? {} : { max: field.max })}
      {...(field.pro === '' ? {} : { proName: field.pro })}
      onCommit={(value) => runCall(ctx, write(value))}
      testId={`halo-numbers-chip-${field.id}`}
    />
  );
}

function ChannelRow(props: { readonly ctx: HaloSheetContext; readonly field: NumbersField }): JSX.Element {
  const { ctx, field } = props;
  const [menu, setMenu] = useState(false);
  const press = useLongPress({ onLongPress: () => setMenu(true) });
  const state = field.keyed === true ? 'keyed here' : field.locked === true ? 'locked' : '';
  return (
    <div data-testid={`halo-numbers-channel-${field.id}`}>
      <FieldRow
        label={field.label}
        pro={[field.pro, state].filter((part) => part !== '').join(' · ')}
        testId={`halo-numbers-row-${field.id}`}
        labelHandlers={press as unknown as Readonly<Record<string, unknown>>}
      >
        <FieldControl ctx={ctx} field={field} />
        <TouchIconButton
          label={`${field.label}: Key, Lock, Reset`}
          icon={<span aria-hidden="true">⋯</span>}
          onClick={() => setMenu((open) => !open)}
        />
      </FieldRow>
      {menu ? (
        <div role="menu" aria-label={`${field.label} menu`} className="flex flex-wrap gap-2 px-2.5 pb-2">
          {(field.menu ?? []).map((item) => (
            <TouchButton
              key={item.label}
              role="menuitem"
              onClick={() => {
                setMenu(false);
                runCall(ctx, item);
              }}
            >
              {item.label}
            </TouchButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SectionView(props: { readonly ctx: HaloSheetContext; readonly section: NumbersSection }): JSX.Element {
  const { ctx, section } = props;
  return (
    <section data-section={section.id} aria-label={section.title} data-testid={`halo-numbers-section-${section.id}`}>
      <SheetGroup>{section.title}</SheetGroup>
      {section.fields.map((field) =>
        field.menu === undefined ? (
          <FieldRow key={field.id} label={field.label} pro={field.pro} testId={`halo-numbers-row-${field.id}`}>
            <FieldControl ctx={ctx} field={field} />
          </FieldRow>
        ) : (
          <ChannelRow key={field.id} ctx={ctx} field={field} />
        ),
      )}
      {section.actions === undefined ? null : (
        <div className="flex flex-wrap gap-2 px-2.5 py-2">
          {section.actions.map((action) => (
            <TouchButton key={action.label} onClick={() => runCall(ctx, action)}>
              {action.label}
            </TouchButton>
          ))}
        </div>
      )}
      {section.link === undefined ? null : (
        <div className="px-2.5 py-2">
          <TouchButton variant="ghost" className="text-accent-text" onClick={() => ctx.open('about')}>
            {section.link.label}
          </TouchButton>
        </div>
      )}
    </section>
  );
}

export default function NumbersSheet({ ctx, args }: HaloSheetProps): JSX.Element {
  useAppVersion(ctx.host.app);
  const sections = numbersSections(ctx.host.app, ctx.noun);
  const body = useRef<HTMLDivElement>(null);
  const wanted = args?.section;
  useEffect(() => {
    if (wanted === undefined) return;
    body.current?.querySelector(`[data-section="${wanted}"]`)?.scrollIntoView({ block: 'start' });
  }, [wanted]);
  return (
    <HaloSheet
      ctx={ctx}
      id="numbers"
      title={numbersTitle(ctx.noun)}
      description="The same values and signs as Studio Pro · hold a row for Key, Lock, Reset"
    >
      <div ref={body}>
        {sections.length === 0 ? (
          <p className="px-2.5 py-4 text-fg-3" data-testid="halo-numbers-empty">
            Tap a part, a mesh or a reference to see its numbers.
          </p>
        ) : null}
        {sections.map((section) => (
          <SectionView key={section.id} ctx={ctx} section={section} />
        ))}
      </div>
    </HaloSheet>
  );
}
