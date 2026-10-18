import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { createContext, type JSX, type ReactNode, useContext } from 'react';
import { cn } from '../cn';

const HasProvider = createContext(false);

/** App-level tooltip provider (shared open delay). Tooltips outside one create their own. */
export function TooltipProvider(props: {
  readonly children?: ReactNode;
  readonly delayDuration?: number;
  readonly skipDelayDuration?: number;
}): JSX.Element {
  return (
    <TooltipPrimitive.Provider
      delayDuration={props.delayDuration ?? 500}
      skipDelayDuration={props.skipDelayDuration ?? 200}
    >
      <HasProvider value={true}>{props.children}</HasProvider>
    </TooltipPrimitive.Provider>
  );
}

export interface TooltipProps {
  readonly content: ReactNode;
  /** One element that accepts a ref (the trigger, rendered with `asChild`). */
  readonly children: ReactNode;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  readonly open?: boolean;
  readonly className?: string;
}

export function Tooltip({ content, children, side = 'bottom', open, className }: TooltipProps): JSX.Element {
  const provided = useContext(HasProvider);
  const tooltip = (
    <TooltipPrimitive.Root {...(open === undefined ? {} : { open })}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-(--z-popover) max-w-xs rounded-field border border-line-strong bg-popover px-2 py-1 text-ui text-fg',
            'shadow-popover whitespace-pre-line',
            className,
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
  return provided ? tooltip : <TooltipPrimitive.Provider delayDuration={500}>{tooltip}</TooltipPrimitive.Provider>;
}
