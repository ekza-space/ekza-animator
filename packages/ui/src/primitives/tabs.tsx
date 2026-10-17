import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentPropsWithRef, JSX } from 'react';
import { cn } from '../cn';

export const Tabs: typeof TabsPrimitive.Root = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentPropsWithRef<typeof TabsPrimitive.List>): JSX.Element {
  return (
    <TabsPrimitive.List
      className={cn('flex h-[var(--size-tab)] items-stretch gap-0.5 border-b border-line bg-header', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentPropsWithRef<typeof TabsPrimitive.Trigger>): JSX.Element {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'select-none px-3 text-ui text-fg-2 outline-none hover:text-fg',
        'data-[state=active]:bg-panel data-[state=active]:text-fg data-[state=active]:shadow-[inset_0_-2px_0_var(--accent)]',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentPropsWithRef<typeof TabsPrimitive.Content>): JSX.Element {
  return <TabsPrimitive.Content className={cn('outline-none', className)} {...props} />;
}
