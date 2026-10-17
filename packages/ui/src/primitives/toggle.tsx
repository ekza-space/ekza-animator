import { Toggle as TogglePrimitive, ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import type { ComponentPropsWithRef, JSX } from 'react';
import { cn } from '../cn';

/**
 * "Toggled on" (research 09 §8.7): pressed fill plus a 2 px accent underline. Keyed on ARIA state (`aria-pressed` for
 * toggles, `aria-checked` for single-choice group items) because a Tooltip trigger wrapped around a toggle replaces
 * its `data-state`. Semantic toggles (auto-key) override the colours.
 */
export const toggleOnClass = cn(
  'aria-pressed:bg-pressed aria-pressed:text-fg aria-pressed:shadow-[inset_0_-2px_0_var(--accent)]',
  'aria-checked:bg-pressed aria-checked:text-fg aria-checked:shadow-[inset_0_-2px_0_var(--accent)]',
);

export const toggleClass = cn(
  'inline-flex h-[var(--size-hit)] min-w-[var(--size-hit)] select-none items-center justify-center gap-1 rounded-button',
  'px-1.5 text-ui text-fg-2 transition-colors duration-[var(--motion-hover)]',
  'hover:enabled:bg-hover hover:enabled:text-fg disabled:cursor-not-allowed disabled:text-fg-disabled',
  toggleOnClass,
);

export type ToggleProps = ComponentPropsWithRef<typeof TogglePrimitive.Root>;

export function Toggle({ className, ...props }: ToggleProps): JSX.Element {
  return <TogglePrimitive.Root className={cn(toggleClass, className)} {...props} />;
}

export type ToggleGroupProps = ComponentPropsWithRef<typeof ToggleGroupPrimitive.Root>;

export function ToggleGroup({ className, ...props }: ToggleGroupProps): JSX.Element {
  return <ToggleGroupPrimitive.Root className={cn('inline-flex items-center gap-0.5', className)} {...props} />;
}

export type ToggleGroupItemProps = ComponentPropsWithRef<typeof ToggleGroupPrimitive.Item>;

export function ToggleGroupItem({ className, ...props }: ToggleGroupItemProps): JSX.Element {
  return <ToggleGroupPrimitive.Item className={cn(toggleClass, className)} {...props} />;
}
