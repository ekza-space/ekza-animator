// Where keyboard focus is, for hotkey suppression (research 09 §7.1 rule 2; ADR 0008 §5; MVP-SPEC §4.10 "Keyboard
// focus").

/** Input types that edit text: typing letters there must never trigger hotkeys. */
const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
]);

/**
 * The element accepts typed text (inputs, textareas, contenteditable, ARIA textboxes). A native dropdown
 * (`<select>`) is not text entry: it is handled by {@link isDropdown} (acceptance round 2).
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return false;
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type.toLowerCase());
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'spinbutton';
}

/** A native dropdown (`<select>`). */
export function isDropdown(target: EventTarget | null): target is HTMLSelectElement {
  return target instanceof HTMLSelectElement;
}

/**
 * Keys a focused dropdown keeps even when the pointer is elsewhere: keyboard navigation of its options (none of them
 * is an editor hotkey). Letters, digits, Home/End, Space and Escape follow the hovered panel instead.
 */
const DROPDOWN_NAVIGATION_CODES: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Enter',
  'NumpadEnter',
  'Tab',
]);

/**
 * How a key pressed while a dropdown has focus is routed (MVP-SPEC §4.10 "Keyboard focus"): 'dropdown' leaves it to
 * the dropdown (native type-ahead and navigation), 'editor' sends it to the keymap of the hovered panel and never
 * lets it type ahead. The dropdown keeps the keyboard while it is under the pointer; otherwise only its navigation
 * keys stay with it. Mod chords always go to the editor (a dropdown has no use for them).
 */
export function dropdownKeyRoute(
  dropdown: HTMLSelectElement,
  input: { readonly code: string; readonly ctrlKey: boolean; readonly metaKey: boolean },
): 'dropdown' | 'editor' {
  if (input.ctrlKey || input.metaKey) return 'editor';
  if (DROPDOWN_NAVIGATION_CODES.has(input.code)) return 'dropdown';
  return isHovered(dropdown) ? 'dropdown' : 'editor';
}

/**
 * A menu button whose menu is closed (a menu bar title, the Graph Editor's "More ▾", a pane header menu). After
 * pointer use the `ui` menus leave no focus on their trigger; one reached with the keyboard keeps it.
 */
export function isClosedMenuTrigger(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  const popup = target.getAttribute('aria-haspopup');
  if (popup !== 'menu' && popup !== 'true') return false;
  return target.getAttribute('aria-expanded') !== 'true';
}

/** Keys a focused menu trigger keeps even when the pointer is elsewhere: opening its menu and menu bar navigation. */
const MENU_TRIGGER_NAVIGATION_CODES: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'NumpadEnter',
  'Tab',
]);

/**
 * How a key pressed while a closed menu's trigger has focus is routed (MVP-SPEC §4.10 "Keyboard focus", acceptance
 * round 3): 'trigger' leaves it to the trigger, 'editor' sends it to the keymap of the hovered panel and never lets
 * the trigger see it (Space would reopen the menu and a second Space run its first item). Like a dropdown, the
 * trigger keeps every key while it is under the pointer; otherwise only Enter, the arrows and Tab stay with it.
 */
export function menuTriggerKeyRoute(
  trigger: HTMLElement,
  input: { readonly code: string; readonly ctrlKey: boolean; readonly metaKey: boolean },
): 'trigger' | 'editor' {
  if (input.ctrlKey || input.metaKey) return 'editor';
  if (MENU_TRIGGER_NAVIGATION_CODES.has(input.code)) return 'trigger';
  return isHovered(trigger) ? 'trigger' : 'editor';
}

function isHovered(element: Element): boolean {
  try {
    return element.matches(':hover');
  } catch {
    return false;
  }
}

/** Focus is inside an open dialog or menu, which owns the keyboard (Radix handles Esc, arrows and typeahead). */
export function isInOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]') !== null;
}
