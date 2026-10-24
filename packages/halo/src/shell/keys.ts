// The `halo` key scope (STUDIO-TOUCH-SPEC §5.8): a small layer over the user's `dcc` keymap, in the capture phase before
// the host's keyboard adapter. Space plays (Halo always plays; Pro's `spaceBehaviour` is untouched); Mod+K or `/`
// opens search; Ctrl+1–4 switch Path stages; Esc and Enter work the session bar; T focuses the first Echo chip; G is
// ⟳ Again. The chords that arrange Studio Pro's window (Alt+1–4, Ctrl+Space, Alt+0) run `halo.proOnlyKey`, whose
// poll always fails with the reason the toast shows — they never write Pro's layout state. A hardware Shift, Cmd or
// Alt hides the Thumb key (§4.5, `auto`). Every other binding reaches the adapter as in Pro.
import type { EditorApp, OperatorDef } from '@ekza-studio/editor-core';
import { en } from '../i18n/en';

export const PRO_ONLY_KEY = 'halo.proOnlyKey';

/** The poll-failing operator of Pro's window chords (§5.8, PLUMBING_ALLOWLIST). */
export const proOnlyKeyDef: OperatorDef<void, void> = {
  id: PRO_ONLY_KEY,
  label: 'Studio Pro Shortcut',
  description: 'A shortcut that arranges Studio Pro’s panels; in Ekza Studio it says so instead.',
  category: 'ui',
  scope: 'global',
  flags: { internal: true },
  poll: () => ({ ok: false, reason: en.toast.proChord }),
  apply() {},
};

export interface KeyActions {
  play(): void;
  search(): void;
  stage(index: number): void;
  sessionDone(): boolean;
  sessionCancel(): boolean;
  /** Esc without a session: close the open Halo, sheet, form or card. */
  dismiss(): boolean;
  focusChip(): void;
  again(): void;
  proOnly(): void;
  hardwareModifier(): void;
}

/** A focused control keeps its own Space and Enter (a petal, a chip, a segment). */
const isControl = (target: EventTarget | null): boolean => {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (target.tagName === 'BUTTON' || target.tagName === 'SUMMARY' || target.tagName === 'A') return true;
  const role = target.getAttribute('role') ?? '';
  return ['button', 'menuitem', 'tab', 'radio', 'slider', 'switch', 'checkbox', 'option'].includes(role);
};

const isField = (target: EventTarget | null): boolean => {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target as HTMLElement).isContentEditable;
};

/** Which Halo action a key press is, or null (the host's adapter takes it). Pure over the event's fields. */
export function haloKey(
  e: Pick<KeyboardEvent, 'code' | 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat'>,
  mac: boolean,
  inField: boolean,
  onControl = false,
): keyof KeyActions | `stage${1 | 2 | 3 | 4}` | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code.startsWith('Meta') || e.code.startsWith('Alt')) {
    return 'hardwareModifier';
  }
  if (e.code === 'Escape') return 'sessionCancel';
  if (inField) return null;
  if (mod && e.code === 'KeyK') return 'search';
  if (e.key === '/' && !mod && !e.altKey) return 'search';
  if (e.code === 'Enter' && !mod && !e.altKey) return onControl ? null : 'sessionDone';
  if (e.code === 'Space' && !mod && !e.altKey && !e.shiftKey && !e.ctrlKey) {
    return e.repeat || onControl ? null : 'play';
  }
  if (e.ctrlKey && !e.altKey && !e.shiftKey && /^Digit[1-4]$/.test(e.code)) {
    return `stage${Number(e.code.slice(5)) as 1 | 2 | 3 | 4}`;
  }
  // Studio Pro's window chords (`PRO_CHROME`): presets, focus and the timeline toggle
  if (e.altKey && !mod && /^Digit[0-4]$/.test(e.code)) return 'proOnly';
  if (e.ctrlKey && e.code === 'Space') return 'proOnly';
  if (!mod && !e.altKey && !e.shiftKey && e.code === 'KeyT') return 'focusChip';
  if (!mod && !e.altKey && !e.shiftKey && e.code === 'KeyG') return 'again';
  return null;
}

/** Installs the scope (capture phase); the disposer removes it. */
export function installHaloKeys(app: EditorApp, actions: KeyActions, blocked: () => boolean): () => void {
  const mac = app.keymap.platform === 'mac';
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || blocked()) return;
    const action = haloKey(e, mac, isField(e.target), isControl(e.target));
    if (action === null) return;
    if (action === 'hardwareModifier') {
      actions.hardwareModifier();
      return;
    }
    let handled = true;
    if (action === 'sessionCancel') handled = actions.sessionCancel() || actions.dismiss();
    else if (action === 'sessionDone') handled = actions.sessionDone();
    else if (action.startsWith('stage')) actions.stage(Number(action.slice(5)) - 1);
    else actions[action as Exclude<keyof KeyActions, 'stage' | 'sessionDone' | 'sessionCancel' | 'dismiss'>]();
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKeyDown, { capture: true });
  return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
}
