// Small form controls for dialogs and panels: native inputs styled with the tokens (native controls keep their
// keyboard behaviour and are the easiest to drive from e2e tests).
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type { ComponentPropsWithRef, JSX, ReactNode } from 'react';
import { cn } from '../cn';

export function TextInput({ className, type = 'text', ...props }: ComponentPropsWithRef<'input'>): JSX.Element {
  return (
    <input
      type={type}
      className={cn(
        'h-[var(--size-field-dialog)] min-w-0 rounded-field border border-line bg-field px-2 text-ui text-fg outline-none',
        'placeholder:text-fg-3 hover:border-line-strong focus:border-accent aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  );
}

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  readonly label?: ReactNode;
}

/** Native checkbox with an optional label (the label wraps the input, so clicking it toggles). */
export function Checkbox({ label, className, ...props }: CheckboxProps): JSX.Element {
  const input = (
    <input
      type="checkbox"
      className={cn('size-3.5 shrink-0 accent-[var(--accent-fill)]', label === undefined ? className : undefined)}
      {...props}
    />
  );
  if (label === undefined) return input;
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer select-none items-center gap-2 text-ui text-fg has-[:disabled]:cursor-not-allowed',
        'has-[:disabled]:text-fg-disabled',
        className,
      )}
    >
      {input}
      <span className="min-w-0">{label}</span>
    </label>
  );
}

export interface NativeSelectProps extends ComponentPropsWithRef<'select'> {
  readonly options: readonly { readonly value: string; readonly label: string; readonly disabled?: boolean }[];
}

export function NativeSelect({ options, className, ...props }: NativeSelectProps): JSX.Element {
  return (
    <select
      className={cn(
        'h-[var(--size-field-dialog)] min-w-0 rounded-field border border-line bg-field px-1.5 text-ui text-fg outline-none',
        'hover:border-line-strong focus:border-accent disabled:text-fg-disabled',
        className,
      )}
      {...props}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function RadioGroup({
  className,
  ...props
}: ComponentPropsWithRef<typeof RadioGroupPrimitive.Root>): JSX.Element {
  return <RadioGroupPrimitive.Root className={cn('flex flex-col gap-1.5', className)} {...props} />;
}

export interface RadioGroupItemProps extends ComponentPropsWithRef<typeof RadioGroupPrimitive.Item> {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
}

/** A radio option rendered as a selectable row (label and optional hint). */
export function RadioGroupItem({ label, hint, className, ...props }: RadioGroupItemProps): JSX.Element {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'flex w-full items-start gap-2.5 rounded-button border border-line bg-field px-3 py-2 text-left outline-none',
        'hover:border-line-strong data-[state=checked]:border-accent data-[state=checked]:bg-selected',
        className,
      )}
      {...props}
    >
      <span className="mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border border-line-strong">
        <RadioGroupPrimitive.Indicator className="block size-2 rounded-full bg-accent-text" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-ui text-fg">{label}</span>
        {hint === undefined ? null : <span className="text-ui-dense text-fg-3">{hint}</span>}
      </span>
    </RadioGroupPrimitive.Item>
  );
}

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent';

const BADGE: Record<BadgeTone, string> = {
  neutral: 'border-line-strong text-fg-2',
  ok: 'border-ok/60 text-ok',
  warn: 'border-warn/60 text-warn',
  danger: 'border-danger/60 text-danger',
  info: 'border-info/60 text-info',
  accent: 'border-accent/60 text-accent-text',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: ComponentPropsWithRef<'span'> & { readonly tone?: BadgeTone }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-button border px-1.5 text-ui-dense font-medium',
        BADGE[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Keyboard chord as keycaps, e.g. `kbd('Ctrl+Shift+S')`. */
export function Kbd({ className, ...props }: ComponentPropsWithRef<'kbd'>): JSX.Element {
  return (
    <kbd
      className={cn(
        'ekza-numeric inline-flex h-5 min-w-5 items-center justify-center rounded-field border border-line-strong',
        'bg-field px-1 font-sans text-ui-dense text-fg-2',
        className,
      )}
      {...props}
    />
  );
}
