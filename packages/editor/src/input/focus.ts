// Where keyboard focus is, for hotkey suppression (research 09 §7.1 rule 2; ADR 0008 §5).

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

/** The element accepts typed text (inputs, textareas, selects, contenteditable, ARIA textboxes). */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type.toLowerCase());
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'spinbutton';
}

/** Focus is inside an open dialog or menu, which owns the keyboard (Radix handles Esc, arrows and typeahead). */
export function isInOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]') !== null;
}
