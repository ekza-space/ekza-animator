import type { ComponentPropsWithRef, JSX, ReactNode } from 'react';
import { cn } from '../cn';
import { Tooltip } from './tooltip';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

const VARIANT: Record<ButtonVariant, string> = {
  default: 'bg-pressed text-fg hover:bg-hover hover:enabled:text-fg border border-line-strong',
  primary: 'bg-accent-fill text-on-accent hover:enabled:bg-accent border border-transparent',
  ghost: 'bg-transparent text-fg-2 hover:enabled:bg-hover hover:enabled:text-fg border border-transparent',
  danger: 'bg-transparent text-danger hover:enabled:bg-hover border border-danger/60',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-[var(--size-field)] px-2 text-ui',
  md: 'h-[var(--size-field-dialog)] px-3 text-ui',
};

export const buttonClass = (variant: ButtonVariant = 'default', size: ButtonSize = 'md'): string =>
  cn(
    'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-button font-medium',
    'transition-colors duration-[var(--motion-hover)] disabled:cursor-not-allowed disabled:text-fg-disabled',
    'disabled:opacity-70',
    VARIANT[variant],
    SIZE[size],
  );

/** Text button. `type` defaults to "button" so a button inside a form never submits by accident. */
export function Button({ variant, size, className, type = 'button', ...props }: ButtonProps): JSX.Element {
  return <button type={type} className={cn(buttonClass(variant, size), className)} {...props} />;
}

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'aria-label'> {
  /** Accessible name; also the tooltip unless `tooltip` is false or a string. */
  readonly label: string;
  readonly icon: ReactNode;
  /** Toggle-button state (`aria-pressed`) with the "toggled on" treatment. */
  readonly pressed?: boolean;
  readonly tooltip?: boolean | string;
  /** Extra text after the label in the tooltip, e.g. a shortcut. */
  readonly shortcut?: string;
}

/** Square icon button with a hit area of at least 24 × 24 px (WCAG 2.2 SC 2.5.8). */
export function IconButton({
  label,
  icon,
  pressed,
  tooltip = true,
  shortcut,
  className,
  type = 'button',
  ...props
}: IconButtonProps): JSX.Element {
  const button = (
    <button
      type={type}
      aria-label={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      className={cn(
        'relative inline-flex size-[var(--size-hit)] shrink-0 items-center justify-center rounded-button text-fg-2',
        'transition-colors duration-[var(--motion-hover)] hover:enabled:bg-hover hover:enabled:text-fg',
        'disabled:cursor-not-allowed disabled:text-fg-disabled',
        'aria-pressed:bg-pressed aria-pressed:text-fg aria-pressed:shadow-[inset_0_-2px_0_var(--accent)]',
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
  if (tooltip === false) return button;
  const text = typeof tooltip === 'string' ? tooltip : label;
  return <Tooltip content={shortcut === undefined ? text : `${text}  ${shortcut}`}>{button}</Tooltip>;
}
