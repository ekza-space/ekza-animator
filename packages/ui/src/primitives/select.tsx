import { Select as SelectPrimitive } from 'radix-ui';
import type { ComponentPropsWithRef, JSX, ReactNode } from 'react';
import { cn } from '../cn';
import { Check, ChevronDown } from '../icons/lucide';
import { menuContentClass, menuItemClass } from './menu';

export const Select: typeof SelectPrimitive.Root = SelectPrimitive.Root;
export const SelectValue: typeof SelectPrimitive.Value = SelectPrimitive.Value;
export const SelectGroup: typeof SelectPrimitive.Group = SelectPrimitive.Group;

export const selectTriggerClass = cn(
  'inline-flex h-[var(--size-field-dialog)] min-w-24 items-center justify-between gap-2 rounded-field border border-line',
  'bg-field px-2 text-ui text-fg outline-none hover:border-line-strong data-[disabled]:text-fg-disabled',
);

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof SelectPrimitive.Trigger>): JSX.Element {
  return (
    <SelectPrimitive.Trigger className={cn(selectTriggerClass, className)} {...props}>
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown size={14} className="text-fg-3" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  sideOffset = 4,
  ...props
}: ComponentPropsWithRef<typeof SelectPrimitive.Content>): JSX.Element {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={sideOffset}
        className={cn(menuContentClass, 'max-h-(--radix-select-content-available-height)', className)}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof SelectPrimitive.Item>): JSX.Element {
  return (
    <SelectPrimitive.Item className={cn(menuItemClass, className)} {...props}>
      <span className="absolute left-1.5 inline-flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check size={14} />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

export interface SimpleSelectProps {
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onValueChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly 'aria-label'?: string;
  readonly 'data-testid'?: string;
  readonly id?: string;
}

/** A Select with its options given as data. */
export function SimpleSelect(props: SimpleSelectProps): JSX.Element {
  return (
    <Select value={props.value} onValueChange={props.onValueChange} {...(props.disabled ? { disabled: true } : {})}>
      <SelectTrigger
        className={props.className}
        {...(props['aria-label'] === undefined ? {} : { 'aria-label': props['aria-label'] })}
        {...(props['data-testid'] === undefined ? {} : { 'data-testid': props['data-testid'] })}
        {...(props.id === undefined ? {} : { id: props.id })}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            {...(option.disabled === true ? { disabled: true } : {})}
            {...(props['data-testid'] === undefined
              ? {}
              : { 'data-testid': `${props['data-testid']}-${option.value}` })}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
