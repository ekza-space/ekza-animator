// Menubar, DropdownMenu and ContextMenu (Radix) with one shared look: dense rows, shortcut column, check marks,
// sub-menus. Props follow Radix; each styled part accepts `className`.
import { ContextMenu as CM, DropdownMenu as DM, Menubar as MB } from 'radix-ui';
import type { ComponentPropsWithRef, JSX, ReactNode } from 'react';
import { cn } from '../cn';
import { Check, ChevronRight } from '../icons/lucide';

export const menuContentClass = cn(
  'z-(--z-popover) min-w-48 overflow-hidden rounded-popover border border-line-strong bg-popover p-1 text-ui text-fg',
  'shadow-popover outline-none',
);
export const menuItemClass = cn(
  'relative flex h-[var(--size-row)] cursor-default select-none items-center gap-2 rounded-field pr-2 pl-6 outline-none',
  'data-[highlighted]:bg-selected data-[highlighted]:text-fg data-[disabled]:text-fg-disabled',
  'data-[disabled]:pointer-events-auto data-[disabled]:cursor-not-allowed',
);
const separatorClass = 'my-1 h-px bg-line';
const labelClass = 'px-6 py-1 text-ui-dense font-semibold text-fg-3';

/** Right-aligned shortcut label inside a menu item. */
export function MenuShortcut({ className, ...props }: ComponentPropsWithRef<'span'>): JSX.Element {
  return <span className={cn('ml-auto pl-6 text-ui-dense text-fg-3 ekza-numeric', className)} {...props} />;
}

function CheckMark(props: { readonly children: ReactNode }): JSX.Element {
  return <span className="absolute left-1.5 inline-flex size-3.5 items-center justify-center">{props.children}</span>;
}

// ---------- Menubar ----------
export const Menubar = ({ className, ...props }: ComponentPropsWithRef<typeof MB.Root>): JSX.Element => (
  <MB.Root className={cn('flex h-full items-center gap-0.5', className)} {...props} />
);
export const MenubarMenu: typeof MB.Menu = MB.Menu;
export const MenubarSub: typeof MB.Sub = MB.Sub;
export const MenubarGroup: typeof MB.Group = MB.Group;
export const MenubarRadioGroup: typeof MB.RadioGroup = MB.RadioGroup;
export const MenubarTrigger = ({ className, ...props }: ComponentPropsWithRef<typeof MB.Trigger>): JSX.Element => (
  <MB.Trigger
    className={cn(
      'flex h-6 select-none items-center rounded-button px-2 text-ui text-fg-2 outline-none',
      'data-[highlighted]:bg-hover data-[highlighted]:text-fg data-[state=open]:bg-pressed data-[state=open]:text-fg',
      className,
    )}
    {...props}
  />
);
export const MenubarContent = ({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: ComponentPropsWithRef<typeof MB.Content>): JSX.Element => (
  <MB.Portal>
    <MB.Content align={align} sideOffset={sideOffset} className={cn(menuContentClass, className)} {...props} />
  </MB.Portal>
);
export const MenubarItem = ({ className, ...props }: ComponentPropsWithRef<typeof MB.Item>): JSX.Element => (
  <MB.Item className={cn(menuItemClass, className)} {...props} />
);
export const MenubarCheckboxItem = ({
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof MB.CheckboxItem>): JSX.Element => (
  <MB.CheckboxItem className={cn(menuItemClass, className)} {...props}>
    <CheckMark>
      <MB.ItemIndicator>
        <Check size={14} />
      </MB.ItemIndicator>
    </CheckMark>
    {children}
  </MB.CheckboxItem>
);
export const MenubarRadioItem = ({
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof MB.RadioItem>): JSX.Element => (
  <MB.RadioItem className={cn(menuItemClass, className)} {...props}>
    <CheckMark>
      <MB.ItemIndicator>
        <span className="block size-1.5 rounded-full bg-fg" />
      </MB.ItemIndicator>
    </CheckMark>
    {children}
  </MB.RadioItem>
);
export const MenubarSeparator = ({ className, ...props }: ComponentPropsWithRef<typeof MB.Separator>): JSX.Element => (
  <MB.Separator className={cn(separatorClass, className)} {...props} />
);
export const MenubarLabel = ({ className, ...props }: ComponentPropsWithRef<typeof MB.Label>): JSX.Element => (
  <MB.Label className={cn(labelClass, className)} {...props} />
);
export const MenubarSubTrigger = ({
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof MB.SubTrigger>): JSX.Element => (
  <MB.SubTrigger className={cn(menuItemClass, 'data-[state=open]:bg-hover', className)} {...props}>
    {children}
    <ChevronRight size={14} className="ml-auto text-fg-3" />
  </MB.SubTrigger>
);
export const MenubarSubContent = ({
  className,
  ...props
}: ComponentPropsWithRef<typeof MB.SubContent>): JSX.Element => (
  <MB.Portal>
    <MB.SubContent className={cn(menuContentClass, className)} {...props} />
  </MB.Portal>
);

// ---------- DropdownMenu ----------
export const DropdownMenu: typeof DM.Root = DM.Root;
export const DropdownMenuTrigger: typeof DM.Trigger = DM.Trigger;
export const DropdownMenuGroup: typeof DM.Group = DM.Group;
export const DropdownMenuSub: typeof DM.Sub = DM.Sub;
export const DropdownMenuRadioGroup: typeof DM.RadioGroup = DM.RadioGroup;
export const DropdownMenuContent = ({
  className,
  sideOffset = 4,
  ...props
}: ComponentPropsWithRef<typeof DM.Content>): JSX.Element => (
  <DM.Portal>
    <DM.Content sideOffset={sideOffset} className={cn(menuContentClass, className)} {...props} />
  </DM.Portal>
);
export const DropdownMenuItem = ({ className, ...props }: ComponentPropsWithRef<typeof DM.Item>): JSX.Element => (
  <DM.Item className={cn(menuItemClass, className)} {...props} />
);
export const DropdownMenuCheckboxItem = ({
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof DM.CheckboxItem>): JSX.Element => (
  <DM.CheckboxItem className={cn(menuItemClass, className)} {...props}>
    <CheckMark>
      <DM.ItemIndicator>
        <Check size={14} />
      </DM.ItemIndicator>
    </CheckMark>
    {children}
  </DM.CheckboxItem>
);
export const DropdownMenuRadioItem = ({
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof DM.RadioItem>): JSX.Element => (
  <DM.RadioItem className={cn(menuItemClass, className)} {...props}>
    <CheckMark>
      <DM.ItemIndicator>
        <span className="block size-1.5 rounded-full bg-fg" />
      </DM.ItemIndicator>
    </CheckMark>
    {children}
  </DM.RadioItem>
);
export const DropdownMenuSeparator = ({
  className,
  ...props
}: ComponentPropsWithRef<typeof DM.Separator>): JSX.Element => (
  <DM.Separator className={cn(separatorClass, className)} {...props} />
);
export const DropdownMenuLabel = ({ className, ...props }: ComponentPropsWithRef<typeof DM.Label>): JSX.Element => (
  <DM.Label className={cn(labelClass, className)} {...props} />
);
export const DropdownMenuSubTrigger = ({
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof DM.SubTrigger>): JSX.Element => (
  <DM.SubTrigger className={cn(menuItemClass, 'data-[state=open]:bg-hover', className)} {...props}>
    {children}
    <ChevronRight size={14} className="ml-auto text-fg-3" />
  </DM.SubTrigger>
);
export const DropdownMenuSubContent = ({
  className,
  ...props
}: ComponentPropsWithRef<typeof DM.SubContent>): JSX.Element => (
  <DM.Portal>
    <DM.SubContent className={cn(menuContentClass, className)} {...props} />
  </DM.Portal>
);

// ---------- ContextMenu ----------
export const ContextMenu: typeof CM.Root = CM.Root;
export const ContextMenuTrigger: typeof CM.Trigger = CM.Trigger;
export const ContextMenuGroup: typeof CM.Group = CM.Group;
export const ContextMenuSub: typeof CM.Sub = CM.Sub;
export const ContextMenuRadioGroup: typeof CM.RadioGroup = CM.RadioGroup;
export const ContextMenuContent = ({ className, ...props }: ComponentPropsWithRef<typeof CM.Content>): JSX.Element => (
  <CM.Portal>
    <CM.Content className={cn(menuContentClass, className)} {...props} />
  </CM.Portal>
);
export const ContextMenuItem = ({ className, ...props }: ComponentPropsWithRef<typeof CM.Item>): JSX.Element => (
  <CM.Item className={cn(menuItemClass, className)} {...props} />
);
export const ContextMenuCheckboxItem = ({
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof CM.CheckboxItem>): JSX.Element => (
  <CM.CheckboxItem className={cn(menuItemClass, className)} {...props}>
    <CheckMark>
      <CM.ItemIndicator>
        <Check size={14} />
      </CM.ItemIndicator>
    </CheckMark>
    {children}
  </CM.CheckboxItem>
);
export const ContextMenuSeparator = ({
  className,
  ...props
}: ComponentPropsWithRef<typeof CM.Separator>): JSX.Element => (
  <CM.Separator className={cn(separatorClass, className)} {...props} />
);
export const ContextMenuLabel = ({ className, ...props }: ComponentPropsWithRef<typeof CM.Label>): JSX.Element => (
  <CM.Label className={cn(labelClass, className)} {...props} />
);
export const ContextMenuSubTrigger = ({
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof CM.SubTrigger>): JSX.Element => (
  <CM.SubTrigger className={cn(menuItemClass, 'data-[state=open]:bg-hover', className)} {...props}>
    {children}
    <ChevronRight size={14} className="ml-auto text-fg-3" />
  </CM.SubTrigger>
);
export const ContextMenuSubContent = ({
  className,
  ...props
}: ComponentPropsWithRef<typeof CM.SubContent>): JSX.Element => (
  <CM.Portal>
    <CM.SubContent className={cn(menuContentClass, className)} {...props} />
  </CM.Portal>
);
