// DOM keyboard adapter (MVP-SPEC §7 WP-8; ADR 0008 §5; research 09 §7.1): KeyboardEvent → `{code, modifiers}` →
// keymap.resolve over the scope chain of the panel under the pointer → operator. Physical keys only
// (`KeyboardEvent.code`), so non-Latin layouts and macOS Option characters (`√` for Alt+V) keep working.
import type {
  KeyBinding,
  KeyInput,
  KeymapManager,
  KeyScope,
  KeyTrigger,
  OperatorId,
  PanelKind,
  RunContext,
} from '@ekza-animator/editor-core';
import { isInOverlay, isTextEntry } from './focus';

/** Tap vs hold threshold (research 09 §7.1 rule 3). */
export const TAP_HOLD_MS = 200;

/**
 * Operators that repeat while their key is held (auto-repeat); every other binding fires once per press. The keymap
 * (WP-7a) applies the same rule to `KeyInput.repeat`; the adapter enforces it too for keymaps that do not.
 */
export const REPEATING_OPERATORS: ReadonlySet<string> = new Set([
  'time.step',
  'time.nextKey',
  'time.prevKey',
  'edit.undo',
  'edit.redo',
  'view.manipulatorSize',
]);

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'CapsLock',
  'Fn',
  'FnLock',
]);

export interface KeyScopeChain {
  /** Most specific first, ending with 'global'. */
  readonly scopes: readonly KeyScope[];
  readonly panel: PanelKind | null;
  readonly paneId: string | null;
}

export interface KeyDispatch {
  readonly op: OperatorId;
  readonly args: unknown;
  readonly ctx: RunContext;
  readonly binding: KeyBinding;
  readonly trigger: KeyTrigger;
}

export interface TimerApi {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface KeyboardAdapterDeps {
  readonly keymap: KeymapManager;
  /** Scope chain of the panel under the pointer, read at keydown. */
  readonly scopeChain: () => KeyScopeChain;
  /** True while a modal dialog is open: the dialog owns the keyboard. */
  readonly blocked: () => boolean;
  /** Preference `spaceBehaviour`: 'play' turns the Space-tap maximize into play/stop (MVP-SPEC §4.10). */
  readonly spaceBehaviour: () => 'maya' | 'play';
  readonly dispatch: (dispatch: KeyDispatch) => void;
  readonly holdMs?: number;
  readonly timers?: TimerApi;
}

interface PendingTapHold {
  readonly code: string;
  readonly input: KeyInput;
  readonly chain: KeyScopeChain;
  timer: unknown;
  held: boolean;
  interrupted: boolean;
}

const browserTimers: TimerApi = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function keyInputOf(event: KeyboardEvent): KeyInput {
  return {
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    repeat: event.repeat,
  };
}

/**
 * Chords whose browser default a dialog or menu needs (copy the licence text, select all, undo in a field): the
 * adapter leaves them alone while the keyboard is blocked even when the editor binds them.
 */
const TEXT_EDITING_CODES: ReadonlySet<string> = new Set(['KeyA', 'KeyC', 'KeyV', 'KeyX', 'KeyY', 'KeyZ']);

/** Mod+S / Mod+Shift+S still save while a text field has focus (browser "Save page" otherwise). */
function isSaveChord(input: KeyInput, platform: 'mac' | 'other'): boolean {
  const mod = platform === 'mac' ? input.metaKey : input.ctrlKey;
  return input.code === 'KeyS' && mod && !input.altKey;
}

export class KeyboardAdapter {
  readonly #deps: KeyboardAdapterDeps;
  readonly #timers: TimerApi;
  #pending: PendingTapHold | null = null;

  constructor(deps: KeyboardAdapterDeps) {
    this.#deps = deps;
    this.#timers = deps.timers ?? browserTimers;
  }

  /** Handles a keydown; returns true when the event was consumed (and default-prevented). */
  keyDown(event: KeyboardEvent): boolean {
    if (event.isComposing || event.key === 'Process' || event.key === 'Dead') return false;
    if (MODIFIER_CODES.has(event.code) || event.code === '') return false;
    const input = keyInputOf(event);
    if (this.#deps.blocked() || isInOverlay(event.target)) {
      // A dialog or menu owns the keyboard: nothing dispatches, but the editor's own chords keep their browser
      // defaults suppressed (Mod+S would open "Save page", Mod+O the browser's file picker).
      if (this.#boundChordWhileBlocked(event, input)) event.preventDefault();
      return false;
    }
    if (isTextEntry(event.target) && !isSaveChord(input, this.#deps.keymap.platform)) return false;

    const pending = this.#pending;
    if (pending !== null && pending.code !== event.code) this.#interrupt(pending);

    if (this.#deps.keymap.isTapHoldKey(event.code)) {
      event.preventDefault(); // Space would scroll the page
      if (event.repeat || pending?.code === event.code) return true;
      const chain = this.#deps.scopeChain();
      const next: PendingTapHold = { code: event.code, input, chain, timer: null, held: false, interrupted: false };
      next.timer = this.#timers.set(() => this.#hold(next), this.#deps.holdMs ?? TAP_HOLD_MS);
      this.#pending = next;
      return true;
    }

    const chain = this.#deps.scopeChain();
    // A held chord is still bound when the keymap refuses its repeats: its browser default (Mod+S "Save page",
    // Mod+O "Open file") must stay suppressed on every repeat.
    const bound = event.repeat
      ? this.#deps.keymap.resolve({ ...input, repeat: false }, chain.scopes, 'press')
      : this.#deps.keymap.resolve(input, chain.scopes, 'press');
    if (bound === null) return false;
    event.preventDefault();
    if (event.repeat) {
      const binding = this.#deps.keymap.resolve(input, chain.scopes, 'press');
      if (binding !== null && REPEATING_OPERATORS.has(binding.op)) this.#dispatch(binding, chain, 'press');
      return true;
    }
    this.#dispatch(bound, chain, 'press');
    return true;
  }

  /** Handles a keyup; resolves Space taps. Returns true when consumed. */
  keyUp(event: KeyboardEvent): boolean {
    const pending = this.#pending;
    if (pending !== null && pending.code === event.code) {
      this.#timers.clear(pending.timer);
      this.#pending = null;
      event.preventDefault();
      // A dialog or menu that opened while the key was down owns the release: no tap behind it.
      if (!pending.held && !pending.interrupted && !this.#deps.blocked() && !isInOverlay(event.target)) {
        const binding = this.#deps.keymap.resolve(pending.input, pending.chain.scopes, 'tap');
        if (binding !== null) this.#dispatch(binding, pending.chain, 'tap');
      }
      return true;
    }
    // Firefox on Windows focuses its menu bar on a bare Alt release.
    if (event.key === 'Alt') {
      event.preventDefault();
      return true;
    }
    return false;
  }

  /** Pointer pressed while a tap/hold key is down: the gesture is a hold, never a tap. */
  pointerActivity(): void {
    const pending = this.#pending;
    if (pending === null || pending.held) return;
    this.#timers.clear(pending.timer);
    this.#hold(pending);
  }

  /** Window blur or a hidden document: forget held keys so nothing fires on return. */
  reset(): void {
    const pending = this.#pending;
    if (pending !== null) this.#timers.clear(pending.timer);
    this.#pending = null;
  }

  /** True while a tap/hold key is down (e.g. Space held). */
  get holding(): boolean {
    return this.#pending !== null;
  }

  /** A Mod chord the keymap binds, outside text editing (see TEXT_EDITING_CODES and text fields). */
  #boundChordWhileBlocked(event: KeyboardEvent, input: KeyInput): boolean {
    if (!input.ctrlKey && !input.metaKey) return false;
    if (TEXT_EDITING_CODES.has(input.code)) return false;
    if (isTextEntry(event.target) && !isSaveChord(input, this.#deps.keymap.platform)) return false;
    const { scopes } = this.#deps.scopeChain();
    return this.#deps.keymap.resolve({ ...input, repeat: false }, scopes, 'press') !== null;
  }

  #interrupt(pending: PendingTapHold): void {
    this.#timers.clear(pending.timer);
    pending.interrupted = true;
  }

  #hold(pending: PendingTapHold): void {
    if (this.#pending !== pending || pending.held || pending.interrupted) return;
    pending.held = true;
    if (this.#deps.blocked()) return;
    const binding = this.#deps.keymap.resolve(pending.input, pending.chain.scopes, 'hold');
    if (binding !== null) this.#dispatch(binding, pending.chain, 'hold');
  }

  #dispatch(binding: KeyBinding, chain: KeyScopeChain, trigger: KeyTrigger): void {
    const ctx: RunContext = {
      ...(chain.panel === null ? {} : { panel: chain.panel }),
      ...(chain.paneId === null ? {} : { paneId: chain.paneId }),
    };
    if (trigger === 'tap' && binding.op === 'view.toggleMaximize' && this.#deps.spaceBehaviour() === 'play') {
      this.#deps.dispatch({ op: 'time.togglePlay', args: undefined, ctx, binding, trigger });
      return;
    }
    this.#deps.dispatch({ op: binding.op, args: binding.args, ctx, binding, trigger });
  }
}
