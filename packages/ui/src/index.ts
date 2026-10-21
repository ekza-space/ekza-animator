// @ekza-studio/ui: design tokens (tokens.json → styles.css custom properties and Tailwind theme), Radix-based
// primitives styled with the tokens (props follow Radix) and the icon set (research 09 §8; MVP-SPEC §7 WP-8).
// Nothing registers on import.
export { cn } from './cn';
export * from './icons/custom';
export * from './icons/lucide';
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  buttonClass,
  IconButton,
  type IconButtonProps,
} from './primitives/button';
export {
  Dialog,
  DialogClose,
  DialogContent,
  type DialogContentProps,
  DialogFooter,
  DialogTrigger,
} from './primitives/dialog';
export {
  Badge,
  type BadgeTone,
  Checkbox,
  type CheckboxProps,
  Kbd,
  NativeSelect,
  type NativeSelectProps,
  RadioGroup,
  RadioGroupItem,
  type RadioGroupItemProps,
  TextInput,
} from './primitives/form';
export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
  MenuShortcut,
  menuContentClass,
  menuItemClass,
} from './primitives/menu';
export { defaultNumberParser, NumberField, type NumberFieldProps, type NumberParser } from './primitives/number-field';
export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger } from './primitives/popover';
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  type SelectOption,
  SelectTrigger,
  SelectValue,
  SimpleSelect,
  type SimpleSelectProps,
  selectTriggerClass,
} from './primitives/select';
export { Tabs, TabsContent, TabsList, TabsTrigger } from './primitives/tabs';
export {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  type ToastKind,
  type ToastProps,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './primitives/toast';
export {
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  type ToggleGroupItemProps,
  type ToggleGroupProps,
  type ToggleProps,
  toggleClass,
  toggleOnClass,
} from './primitives/toggle';
export { Tooltip, type TooltipProps, TooltipProvider } from './primitives/tooltip';
