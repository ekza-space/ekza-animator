// Pre-run forms (STUDIO-TOUCH-SPEC §5.6, D5, ST-16): an operator that cannot be adjusted after its run opens its
// parameters as chips before it, filled with the defaults, with ✓ to run — *Fewer keys ⟨tolerance 0.5⟩ ✓*. The values
// come from Halo-only form data (`@ekza-studio/editor-core/forms`): Pro, Repeat Last and the MCP schemas never read
// it. Values the run reads from the session show read-only (*at 0.50 s*). A lazy chunk, loaded with the first form.
import type { ParamDef } from '@ekza-studio/anim-core';
import { formArgs, formDefaults, formOf } from '@ekza-studio/editor-core/forms';
import { ActionChip, type Box, Segmented, ToggleChip, TouchButton, ValueChip } from '@ekza-studio/ui/touch';
import { type JSX, useMemo, useState } from 'react';
import { Icon } from '../halo/icons';
import { en } from '../i18n/en';
import type { HaloController } from '../shell/controller';
import { useHaloStore } from '../shell/store';
import { chipLabel, chipOf } from './EchoChips';

type Values = Readonly<Record<string, unknown>>;

function FieldChip({
  param,
  value,
  onChange,
}: {
  readonly param: ParamDef;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}): JSX.Element | null {
  if (param.kind === 'bool') {
    return <ToggleChip label={chipLabel(param)} pressed={value === true} onPressedChange={onChange} />;
  }
  if ((param.kind === 'enum' || param.kind === 'axis') && param.options !== undefined) {
    if (param.options.length <= 4) {
      return (
        <Segmented<string>
          label={chipLabel(param)}
          value={typeof value === 'string' ? value : (param.options[0]?.value ?? '')}
          onValueChange={onChange}
          items={param.options.map((o) => ({ value: o.value, label: o.label }))}
        />
      );
    }
    const index = param.options.findIndex((o) => o.value === value);
    const next = param.options[(index + 1) % param.options.length];
    return (
      <ActionChip onClick={() => onChange(next?.value)}>
        {param.label} · {param.options[Math.max(0, index)]?.label ?? ''}
      </ActionChip>
    );
  }
  if (param.kind === 'data') return null;
  const shape = chipOf(param);
  const stored = typeof value === 'number' ? value : typeof param.default === 'number' ? param.default : 0;
  return (
    <ValueChip
      data-testid={`halo-form-${param.name}`}
      label={chipLabel(param)}
      value={shape.toShown(stored)}
      step={shape.step}
      {...(shape.unit === undefined ? {} : { unit: shape.unit })}
      {...(shape.min === undefined ? {} : { min: shape.min })}
      {...(shape.max === undefined ? {} : { max: shape.max })}
      onChange={(v) => onChange(shape.toStored(v))}
    />
  );
}

export default function FormChips({
  controller,
  box,
  width,
  insetBottom,
}: {
  readonly controller: HaloController;
  readonly box: Box | null;
  readonly width: number;
  readonly insetBottom: number;
}): JSX.Element | null {
  const { ctx } = controller;
  const pending = useHaloStore(ctx.store, (s) => s.form);
  const form = useMemo(
    () => (pending === null ? null : formOf(pending.op, ctx.app.operators.get(pending.op))),
    [ctx.app, pending],
  );
  const [values, setValues] = useState<Values>(() => (form === null ? {} : formDefaults(form)));
  if (pending === null || form === null) return null;
  const label = ctx.app.operators.get(pending.op)?.label ?? pending.op;
  const time = ctx.app.session.getState().time.sceneFrame;
  const close = (): void => ctx.store.set({ form: null });
  const runForm = (): void => {
    const base = typeof pending.args === 'object' && pending.args !== null ? (pending.args as Values) : undefined;
    const { args } = formArgs(form, values, base);
    close();
    void ctx.run(pending.op, args);
  };
  const left = box === null || width - box.right < 300 ? 16 : box.right + 20;
  const style = box === null || width - box.right < 300 ? { left, bottom: insetBottom + 64 } : { left, top: box.top };
  return (
    <fieldset
      aria-label={label}
      data-halo-chrome=""
      data-testid="halo-form"
      data-op={pending.op}
      className="pointer-events-auto absolute m-0 flex min-w-0 max-w-[min(560px,calc(100%-32px))] flex-wrap items-center gap-2 rounded-touch-card border border-line bg-touch-surface p-2 shadow-touch backdrop-blur-md"
      style={style}
    >
      <span className="px-2 font-semibold">{label}</span>
      {form.params.map((param) => (
        <FieldChip
          key={param.name}
          param={param}
          value={values[param.name]}
          onChange={(value) => setValues((prev) => ({ ...prev, [param.name]: value }))}
        />
      ))}
      {form.fromSession.includes('time') ? (
        <span className="px-2 text-touch-label text-fg-2">{en.chips.at(`frame ${time}`)}</span>
      ) : null}
      <TouchButton variant="ghost" aria-label={en.chips.cancel} data-testid="halo-form-cancel" onClick={close}>
        <Icon name="close" />
      </TouchButton>
      <TouchButton variant="primary" data-testid="halo-form-run" onClick={runForm}>
        <Icon name="check" />
        {en.chips.run}
      </TouchButton>
    </fieldset>
  );
}
