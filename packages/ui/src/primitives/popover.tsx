import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ComponentPropsWithRef, JSX } from 'react';
import { cn } from '../cn';

export const Popover: typeof PopoverPrimitive.Root = PopoverPrimitive.Root;
export const PopoverTrigger: typeof PopoverPrimitive.Trigger = PopoverPrimitive.Trigger;
export const PopoverAnchor: typeof PopoverPrimitive.Anchor = PopoverPrimitive.Anchor;
export const PopoverClose: typeof PopoverPrimitive.Close = PopoverPrimitive.Close;

/** Non-blocking option box (research 09 §1 principle 4: no modal dialogs while animating). */
export function PopoverContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  ...props
}: ComponentPropsWithRef<typeof PopoverPrimitive.Content>): JSX.Element {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'z-(--z-popover) rounded-popover border border-line-strong bg-popover p-3 text-ui text-fg shadow-popover',
          'outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
