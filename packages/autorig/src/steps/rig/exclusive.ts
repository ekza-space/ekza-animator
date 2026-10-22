// §4.5 exclusivity of the progress sheet (AUTORIG-SPEC §4.5, §5.4; D4): while the sheet is up, every Auto-Rig control
// but *Cancel* is off. The native modal `<dialog>` makes the page inert for the pointer; the keyboard is this guard's:
// one window `keydown` listener in the capture phase, installed when this module is evaluated — `steps/rig/index.ts`,
// in `/autorig`'s first visit, calls it at import — so it is registered before the frame's own `autorig` key scope
// (D3's controller adds its listener when the shell mounts) and runs first. While an open sheet (`[data-ar-exclusive]`)
// is in the document, a key press reaches no other listener (`stopImmediatePropagation`: not the frame's `Alt+1…5`,
// `Mod+Enter` or undo rows, not a step's keys, not the host's keyboard adapter) and its browser default is prevented,
// except the sheet's own keyboard: `Tab` / `Shift+Tab` and `Enter` / `Space` on a button of the sheet keep their
// default (focus, *Cancel*). A key aimed at another open dialog (the host's confirm, above the sheet) is that dialog's.
// Never removed: one listener for the page's lifetime, a no-op without an open sheet.

/** The attribute an exclusive sheet carries. */
export const EXCLUSIVE_ATTRIBUTE = 'data-ar-exclusive';

/** What the guard does with a key press: leave it alone, keep its default but stop every listener, or swallow it. */
export type ExclusiveRoute = 'pass' | 'isolate' | 'swallow';

/** The parts of a DOM element the guard reads (duck-typed for the unit tests). */
export interface GuardElement {
  readonly tagName?: string;
  contains(other: unknown): boolean;
  closest?(selector: string): GuardElement | null;
}

export interface GuardKey {
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly target: unknown;
}

const MODIFIERS = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
]);
const ACTIVATE = new Set(['Enter', 'NumpadEnter', 'Space']);
const OTHER_DIALOG = 'dialog[open], [role="dialog"], [role="alertdialog"]';

const asElement = (value: unknown): GuardElement | null =>
  value !== null && typeof value === 'object' && typeof (value as GuardElement).contains === 'function'
    ? (value as GuardElement)
    : null;

/** The route of a key press while `sheet` is open (null: no sheet, every key passes). Pure. */
export function exclusiveRoute(e: GuardKey, sheet: GuardElement | null): ExclusiveRoute {
  if (sheet === null) return 'pass';
  const target = asElement(e.target);
  const inSheet = target !== null && sheet.contains(target);
  if (!inSheet && target !== null && typeof target.closest === 'function') {
    const dialog = target.closest(OTHER_DIALOG);
    if (dialog !== null && dialog !== sheet && !sheet.contains(dialog)) return 'pass';
  }
  if (MODIFIERS.has(e.code)) return 'isolate';
  const chord = e.altKey || e.ctrlKey || e.metaKey;
  if (e.code === 'Tab' && !chord) return 'isolate';
  if (ACTIVATE.has(e.code) && !chord && inSheet && target?.tagName === 'BUTTON') return 'isolate';
  return 'swallow';
}

const FLAG = Symbol.for('ekza-studio.autorig.exclusive-keys');

function onKeyDown(e: KeyboardEvent): void {
  const sheet = document.querySelector(`[${EXCLUSIVE_ATTRIBUTE}]`);
  const route = exclusiveRoute(e, sheet);
  if (route === 'pass') return;
  e.stopImmediatePropagation();
  if (route === 'swallow') e.preventDefault();
}

/** Installs the guard once per window (idempotent; nothing without a window). */
export function installExclusiveKeys(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const host = window as unknown as Record<symbol, boolean | undefined>;
  if (host[FLAG] === true) return;
  host[FLAG] = true;
  window.addEventListener('keydown', onKeyDown, { capture: true });
}
