// DOM keyboard adapter (MVP-SPEC §7 WP-8; ADR 0008 §5; research 09 §7.1): KeyboardEvent → `{code, modifiers}` →
// keymap.resolve over the scope chain of the panel under the pointer → operator. Physical keys only
// (`KeyboardEvent.code`), so non-Latin layouts and macOS Option characters (`√` for Alt+V) keep working.
//
// M6a (M6A-SPEC §5.17, B0b): the scope chain is hierarchical in a workspace with a key scope (Model), and every
// keydown and keyup goes through three steps, the first that consumes the key stops it:
//   1. the numeric capture window (`app.capture.key`, keydown only, while armed);
//   2. the active viewport tool's `key()` (a `ToolKeyEvent`), when the pointer is over a viewport pane and the code
//      is in the tool's `ToolDef.keys`, or the tool is placing or dragging and the code is a reserved modal key;
//   3. the keymap: tap/hold deferral, then `resolve` over the scope chain.
import {
  type Chord,
  type EditorApp,
  GLOBAL_SCOPE,
  type KeyBinding,
  type KeyInput,
  type KeymapManager,
  type KeyScope,
  type KeyTrigger,
  keyScopeChain,
  type OperatorId,
  PANEL,
  type PanelKind,
  RESERVED_MODAL_KEYS,
  type RunContext,
  resolveChord,
  type ToolInstance,
  type ToolKeyEvent,
  type ToolPhase,
} from '@ekza-animator/editor-core';
import { dropdownKeyRoute, isDropdown, isInOverlay, isTextEntry } from './focus';

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
  // M6a (§5.6): grow/shrink keep going while held; the history coalesces the repeats into one step.
  'select.mesh.grow',
  'select.mesh.shrink',
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

/** What the scope chain needs to know about the panel under the pointer (the shell's `HoverTarget`). */
export interface HoveredPanel {
  readonly kind: PanelKind;
  readonly scope: KeyScope;
  readonly paneId: string | null;
}

/**
 * The scope chain under the pointer (§5.17): in a workspace with a key scope (Model) over a viewport pane
 * `model.viewport.<mode>` → `model.viewport.component` (component modes) → `model.viewport` → `viewport` → `model` →
 * `global`; over another panel `model.<panel>` → `<panel>` → `model` → `global`. Animate keeps `<panel>` → `global`.
 */
export function scopeChain(app: Pick<EditorApp, 'session' | 'workspaces'>, hover: HoveredPanel | null): KeyScopeChain {
  const session = app.session.getState();
  const scopes = keyScopeChain({
    workspace: app.workspaces.get(session.workspace)?.keyScope ?? null,
    panel: hover === null || hover.scope === GLOBAL_SCOPE ? null : hover.scope,
    viewport: hover?.kind === PANEL.viewport,
    mode: session.model.componentMode,
  });
  return { scopes, panel: hover?.kind ?? null, paneId: hover?.paneId ?? null };
}

/** The active viewport tool as the keyboard sees it (step 2 of the adapter order). */
export interface ToolKeyTarget {
  /** `ToolDef.keys`: codes the tool receives first in any phase. */
  readonly keys: readonly string[];
  phase(): ToolPhase;
  /** True when the tool acted on the key (observing a hold returns false). */
  key(e: ToolKeyEvent): boolean;
}

/** The viewport tool-key bridge: the session's viewport tool, its `ToolDef.keys` and the instance's `key()`. */
export function viewportToolTarget(
  app: Pick<EditorApp, 'session' | 'tools'>,
  activeTool: () => ToolInstance | null,
): ToolKeyTarget | null {
  const instance = activeTool();
  if (instance === null || instance.key === undefined) return null;
  const def = app.tools.get(PANEL.viewport, app.session.getState().tools.viewport);
  return {
    keys: def?.keys ?? [],
    phase: () => instance.phase?.() ?? 'idle',
    key: (e) => instance.key?.(e) === true,
  };
}

/** What the numeric capture window receives (`NumericCaptureApi.key`). */
export interface CaptureKeyEvent {
  readonly code: string;
  readonly key: string;
  readonly shift: boolean;
  readonly mod: boolean;
  readonly alt: boolean;
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
  /** Step 1: the numeric capture window (`app.capture.key`); true = consumed. Keydown only. */
  readonly capture?: (e: CaptureKeyEvent) => boolean;
  /** Step 2: the active tool of a viewport pane, when there is one that takes keys. */
  readonly viewportTool?: (paneId: string) => ToolKeyTarget | null;
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

/** The tap/hold modifiers of a key input (`mod` = Cmd on macOS, Ctrl elsewhere; `ctrl` = the Ctrl key). */
export function modsOf(
  input: KeyInput,
  platform: 'mac' | 'other',
): { readonly mod: boolean; readonly shift: boolean; readonly alt: boolean; readonly ctrl: boolean } {
  return {
    mod: platform === 'mac' ? input.metaKey : input.ctrlKey,
    shift: input.shiftKey,
    alt: input.altKey,
    ctrl: input.ctrlKey,
  };
}

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

/**
 * Chords whose browser default takes the page away from the editor (M6A-SPEC §7 QA matrix: F10 focuses the browser
 * menu, Mod+B/Mod+D bookmarks, Mod+G find next, Mod+Shift+E Firefox's Network Monitor, Mod+K the search bar): the
 * adapter suppresses them even where no binding answers them in the current chain (outside text fields).
 */
const QA_CHORDS: readonly Chord[] = [
  { code: 'F10' },
  { code: 'KeyB', mod: true },
  { code: 'KeyD', mod: true },
  { code: 'KeyG', mod: true },
  { code: 'KeyE', mod: true, shift: true },
  { code: 'KeyK', mod: true },
];

export function isQaChord(input: KeyInput, platform: 'mac' | 'other'): boolean {
  const mods = modsOf(input, platform);
  return QA_CHORDS.some(
    (chord) =>
      chord.code === input.code &&
      mods.mod === (chord.mod === true) &&
      mods.shift === (chord.shift === true) &&
      !mods.alt &&
      (platform === 'other' || !mods.ctrl),
  );
}

export class KeyboardAdapter {
  readonly #deps: KeyboardAdapterDeps;
  readonly #timers: TimerApi;
  #pending: PendingTapHold | null = null;
  /** Codes whose keydown the capture window consumed: their keyup is swallowed too. */
  readonly #captured = new Set<string>();
  /** Codes whose keydown went to a viewport tool: the tool gets their keyup wherever the pointer is then. */
  readonly #toolHeld = new Map<string, ToolKeyTarget>();

  constructor(deps: KeyboardAdapterDeps) {
    this.#deps = deps;
    this.#timers = deps.timers ?? browserTimers;
  }

  /** Handles a keydown; returns true when the event was consumed (and default-prevented). */
  keyDown(event: KeyboardEvent): boolean {
    if (event.isComposing || event.key === 'Process' || event.key === 'Dead') return false;
    if (MODIFIER_CODES.has(event.code) || event.code === '') return false;
    const input = keyInputOf(event);
    const platform = this.#deps.keymap.platform;
    if (this.#deps.blocked() || isInOverlay(event.target)) {
      // A dialog or menu owns the keyboard: nothing dispatches, but the editor's own chords keep their browser
      // defaults suppressed (Mod+S would open "Save page", Mod+O the browser's file picker).
      if (this.#boundChordWhileBlocked(event, input)) event.preventDefault();
      return false;
    }
    if (isTextEntry(event.target) && !isSaveChord(input, platform)) return false;
    // A focused dropdown keeps type-ahead and navigation only while it is under the pointer; otherwise the key
    // follows the hovered panel and must not change the dropdown's value (acceptance round 2, §4.10).
    let fromDropdown = false;
    if (isDropdown(event.target)) {
      if (dropdownKeyRoute(event.target, input) === 'dropdown') return false;
      fromDropdown = true;
    }

    const pending = this.#pending;
    if (pending !== null && pending.code !== event.code) this.#interrupt(pending);

    // 1. The numeric capture window (§5.10).
    const mods = modsOf(input, platform);
    if (this.#deps.capture?.({ code: event.code, key: event.key, shift: mods.shift, mod: mods.mod, alt: mods.alt })) {
      event.preventDefault();
      this.#captured.add(event.code);
      return true;
    }

    const chain = this.#deps.scopeChain();
    // 2. The active viewport tool.
    if (this.#toolKey('down', event, input, chain)) {
      event.preventDefault();
      return true;
    }

    // 3. The keymap.
    if (this.#deps.keymap.isTapHoldKey(event.code, chain.scopes, mods)) {
      event.preventDefault(); // Space would scroll the page
      if (event.repeat || pending?.code === event.code) return true;
      const next: PendingTapHold = { code: event.code, input, chain, timer: null, held: false, interrupted: false };
      next.timer = this.#timers.set(() => this.#hold(next), this.#deps.holdMs ?? TAP_HOLD_MS);
      this.#pending = next;
      return true;
    }

    // A held chord is still bound when the keymap refuses its repeats: its browser default (Mod+S "Save page",
    // Mod+O "Open file") must stay suppressed on every repeat.
    const bound = event.repeat
      ? this.#deps.keymap.resolve({ ...input, repeat: false }, chain.scopes, 'press')
      : this.#deps.keymap.resolve(input, chain.scopes, 'press');
    if (bound === null) {
      // No hotkey, but a printable key would still type ahead into the dropdown the pointer is not on.
      if ((fromDropdown && event.key.length === 1) || isQaChord(input, platform)) event.preventDefault();
      return false;
    }
    event.preventDefault();
    if (event.repeat) {
      const binding = this.#deps.keymap.resolve(input, chain.scopes, 'press');
      if (binding !== null && REPEATING_OPERATORS.has(binding.op)) this.#dispatch(binding, chain, 'press', true);
      return true;
    }
    this.#dispatch(bound, chain, 'press');
    return true;
  }

  /** Handles a keyup: a capture-consumed key stays consumed, tools see their keys go up, taps resolve. */
  keyUp(event: KeyboardEvent): boolean {
    if (this.#captured.delete(event.code)) {
      event.preventDefault();
      return true;
    }
    const pending = this.#pending;
    if (this.#toolKey('up', event, keyInputOf(event), null)) {
      event.preventDefault();
      // The tool acted on the release: no tap behind it.
      if (pending !== null && pending.code === event.code) this.#clearPending(pending);
      return true;
    }
    if (pending !== null && pending.code === event.code) {
      this.#clearPending(pending);
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

  /** Pointer pressed while a tap/hold key is down: the gesture is a hold, never a tap (`B`+drag = radius). */
  pointerActivity(): void {
    const pending = this.#pending;
    if (pending === null || pending.held) return;
    this.#timers.clear(pending.timer);
    this.#hold(pending);
  }

  /** Window blur or a hidden document: forget held keys so nothing fires on return; tools see their keys go up. */
  reset(): void {
    const pending = this.#pending;
    if (pending !== null) this.#timers.clear(pending.timer);
    this.#pending = null;
    this.#captured.clear();
    const held = [...this.#toolHeld];
    this.#toolHeld.clear();
    for (const [code, target] of held) {
      target.key({ type: 'up', code, shift: false, alt: false, mod: false, ctrl: false, repeat: false });
    }
  }

  /** True while a tap/hold key is down (e.g. Space held). */
  get holding(): boolean {
    return this.#pending !== null;
  }

  /**
   * Step 2 of the adapter order. Keydown: over a viewport pane, a code in the tool's `keys` (any phase), or a reserved
   * modal key while the tool is placing or dragging, goes to `key()` first. Keyup: the tool that got the keydown gets
   * the release, wherever the pointer is. Returns true when the tool consumed the key.
   */
  #toolKey(type: 'down' | 'up', event: KeyboardEvent, input: KeyInput, chain: KeyScopeChain | null): boolean {
    let target: ToolKeyTarget | null = null;
    if (type === 'up') {
      target = this.#toolHeld.get(event.code) ?? null;
      this.#toolHeld.delete(event.code);
    }
    if (target === null) {
      const at = chain ?? this.#deps.scopeChain();
      if (at.panel !== PANEL.viewport || at.paneId === null || this.#deps.viewportTool === undefined) return false;
      const tool = this.#deps.viewportTool(at.paneId);
      if (tool === null) return false;
      const phase = tool.phase();
      const modal = (phase === 'placing' || phase === 'dragging') && RESERVED_MODAL_KEYS.has(event.code);
      if (!modal && !tool.keys.includes(event.code)) return false;
      target = tool;
      if (type === 'down') this.#toolHeld.set(event.code, tool);
    }
    const mods = modsOf(input, this.#deps.keymap.platform);
    return target.key({
      type,
      code: event.code,
      shift: mods.shift,
      alt: mods.alt,
      mod: mods.mod,
      ctrl: mods.ctrl,
      repeat: type === 'down' && event.repeat,
    });
  }

  /** A Mod chord the keymap binds, or a QA chord, outside text editing (see TEXT_EDITING_CODES and text fields). */
  #boundChordWhileBlocked(event: KeyboardEvent, input: KeyInput): boolean {
    if (isTextEntry(event.target) && !isSaveChord(input, this.#deps.keymap.platform)) return false;
    if (isQaChord(input, this.#deps.keymap.platform)) return true;
    if (!input.ctrlKey && !input.metaKey) return false;
    if (TEXT_EDITING_CODES.has(input.code)) return false;
    const { scopes } = this.#deps.scopeChain();
    return this.#deps.keymap.resolve({ ...input, repeat: false }, scopes, 'press') !== null;
  }

  #clearPending(pending: PendingTapHold): void {
    this.#timers.clear(pending.timer);
    if (this.#pending === pending) this.#pending = null;
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

  #dispatch(binding: KeyBinding, chain: KeyScopeChain, trigger: KeyTrigger, repeat = false): void {
    // M6a (§4.6): keyboard runs carry their source and the auto-repeat flag (selection coalescing, LastRun).
    const ctx: RunContext = {
      ...(chain.panel === null ? {} : { panel: chain.panel }),
      ...(chain.paneId === null ? {} : { paneId: chain.paneId }),
      source: 'keyboard',
      ...(repeat ? { repeat: true } : {}),
    };
    if (trigger === 'tap' && binding.op === 'view.toggleMaximize' && this.#deps.spaceBehaviour() === 'play') {
      this.#deps.dispatch({ op: 'time.togglePlay', args: undefined, ctx, binding, trigger });
      return;
    }
    this.#deps.dispatch({ op: binding.op, args: binding.args, ctx, binding, trigger });
  }
}

// ---------- help line (§5.17: "the help line shows the resolved meaning under the pointer") ----------

/** Chords the Model help line explains, in order (§8.2), with the trigger they run on. */
export const HELP_CHORDS: readonly (readonly [Chord, KeyTrigger])[] = [
  [{ code: 'KeyE', mod: true }, 'press'],
  [{ code: 'KeyB', mod: true }, 'press'],
  [{ code: 'KeyB' }, 'tap'],
  [{ code: 'KeyK' }, 'press'],
  [{ code: 'KeyM' }, 'press'],
  [{ code: 'KeyG' }, 'press'],
  [{ code: 'KeyT' }, 'press'],
];

const titleCase = (id: string): string =>
  id
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_.\s]+/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

/** What a binding does, in words: the operator label, the tool's label for `view.tool`, the menu for marking menus. */
export function bindingMeaning(app: Pick<EditorApp, 'operators' | 'tools'>, binding: KeyBinding): string {
  const args = (binding.args ?? {}) as { readonly panel?: unknown; readonly tool?: unknown; readonly menu?: unknown };
  if (binding.op === 'view.tool' && typeof args.panel === 'string' && typeof args.tool === 'string') {
    return app.tools.get(args.panel, args.tool)?.label ?? titleCase(args.tool);
  }
  if (binding.op === 'ui.markingMenu' && typeof args.menu === 'string') {
    return `${titleCase(args.menu.slice(args.menu.lastIndexOf('.') + 1))} menu`;
  }
  return app.operators.get(binding.op)?.label ?? binding.op;
}

/**
 * The meaning of `chords` over `scopes`, labelled through `KeymapManager.label` (`⌘E Extrude` on macOS, `Ctrl+E
 * Extrude` elsewhere); a chord that resolves to nothing there is left out.
 */
export function keyHints(
  app: Pick<EditorApp, 'keymap' | 'operators' | 'tools'>,
  scopes: readonly KeyScope[],
  chords: readonly (readonly [Chord, KeyTrigger])[] = HELP_CHORDS,
): string[] {
  const out: string[] = [];
  for (const [chord, trigger] of chords) {
    const binding = resolveChord(app.keymap, chord, scopes, trigger);
    if (binding !== null) out.push(`${app.keymap.label(chord)} ${bindingMeaning(app, binding)}`);
  }
  return out;
}

/** The help line's key hints under the pointer: null in a workspace without a key scope (Animate keeps its text). */
export function helpHints(
  app: Pick<EditorApp, 'keymap' | 'operators' | 'tools' | 'session' | 'workspaces'>,
  hover: HoveredPanel | null,
): string | null {
  if ((app.workspaces.get(app.session.getState().workspace)?.keyScope ?? null) === null) return null;
  const hints = keyHints(app, scopeChain(app, hover).scopes);
  return hints.length === 0 ? null : hints.join(' · ');
}
