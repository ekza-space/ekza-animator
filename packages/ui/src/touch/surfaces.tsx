// Touch scope, buttons and the frosted cluster surface (STUDIO-TOUCH-SPEC §4.1, §18). Every target is at least
// 44 × 44 px (`--touch-hit`, scaled up by the Text & touch size, never down) and labels use words.
import type { ComponentPropsWithRef, JSX, ReactNode } from 'react';
import { cn } from '../cn';
import { touchScopeProps } from './constants';

export interface TouchRootProps extends ComponentPropsWithRef<'div'> {
  /** The Text & touch size preference (`prefs.uiScale`), clamped to 0.85–1.5. */
  readonly uiScale?: number;
}

/** A touch scope: `[data-density="touch"]` with its scale. Every touch-kit component renders inside one. */
export function TouchRoot({ uiScale, className, style, ...props }: TouchRootProps): JSX.Element {
  const scope = touchScopeProps(uiScale);
  return (
    <div
      data-density={scope['data-density']}
      style={{ ...scope.style, ...style }}
      className={cn('ekza-touch', className)}
      {...props}
    />
  );
}

export type TouchButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';

const VARIANT: Record<TouchButtonVariant, string> = {
  default: 'border border-line bg-header text-fg hover:enabled:bg-hover active:enabled:bg-pressed',
  primary: 'border border-transparent bg-accent-fill text-on-accent active:enabled:brightness-90',
  ghost:
    'border border-transparent bg-transparent text-fg-2 hover:enabled:bg-hover hover:enabled:text-fg active:enabled:bg-pressed',
  danger: 'border border-danger/60 bg-transparent text-danger hover:enabled:bg-hover active:enabled:bg-pressed',
};

export const touchButtonClass = (variant: TouchButtonVariant = 'default'): string =>
  cn(
    'inline-flex min-h-(--touch-hit) min-w-(--touch-hit) select-none items-center justify-center gap-2',
    'whitespace-nowrap rounded-touch px-4 text-touch font-medium transition-colors duration-(--motion-hover)',
    'disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:opacity-45',
    VARIANT[variant],
  );

export interface TouchButtonProps extends ComponentPropsWithRef<'button'> {
  readonly variant?: TouchButtonVariant;
  readonly icon?: ReactNode;
}

/** A 44 px text button; `type` defaults to "button". */
export function TouchButton({
  variant,
  icon,
  className,
  type = 'button',
  children,
  ...props
}: TouchButtonProps): JSX.Element {
  return (
    <button type={type} className={cn(touchButtonClass(variant), className)} {...props}>
      {icon}
      {children}
    </button>
  );
}

export interface TouchIconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'children'> {
  /** The accessible name (there are no hover tooltips on touch: §6.3). */
  readonly label: string;
  readonly icon: ReactNode;
  readonly pressed?: boolean;
  /** 44 px (default) or 48 px (the off-hand column's ↶). */
  readonly size?: 'md' | 'lg';
}

/** A round icon-only button with an accessible name. */
export function TouchIconButton({
  label,
  icon,
  pressed,
  size = 'md',
  className,
  type = 'button',
  ...props
}: TouchIconButtonProps): JSX.Element {
  return (
    <button
      type={type}
      aria-label={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full border border-line bg-touch-surface',
        'text-fg-2 shadow-touch backdrop-blur-md transition-colors duration-(--motion-hover)',
        'hover:enabled:text-fg active:enabled:bg-pressed disabled:cursor-not-allowed disabled:opacity-45',
        'aria-pressed:bg-accent-fill aria-pressed:text-on-accent',
        size === 'lg' ? 'size-[max(48px,var(--touch-hit))]' : 'size-(--touch-hit)',
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
}

/** The frosted surface of an edge cluster (top bar groups, tray, off-hand column, session bar). */
export function Cluster({ className, ...props }: ComponentPropsWithRef<'div'>): JSX.Element {
  return (
    <div
      className={cn('rounded-touch-card border border-line bg-touch-surface shadow-touch backdrop-blur-md', className)}
      {...props}
    />
  );
}
