// Numeric capture window and the Last-op card's open state (M6A-SPEC §5.10, §5.7 `T`, §8.6; B11).
//
// The capture window is **armed** (a) during an active drag of a tool, manipulator or card virtual slider (the tool's
// `NumericTarget`, active field = the dragged field) and (b) right after an operator invoked from the keyboard
// finishes with a live `lastRun` that has a primary param (the Last-op card, active field = the primary). While armed
// the keyboard adapter offers keydowns to `key()` before anything else (§5.17 step 1):
// - a digit, `.` or `-` starts an entry for the active field (then the grammar's other characters extend it); a digit
//   consumed this way never also switches mode or shading;
// - `Backspace` edits the entry; `Tab`/`Shift+Tab` apply it and move between the target's fields;
// - `Enter` applies (a: confirms the drag with the typed value; b: `edit.adjustLast {[field]: value}`, announced once the
//   re-run finished; a refusal is reported and keeps the entry) and disarms; `Enter` with no entry confirms the drag
//   (a) or is a no-op that disarms (b);
// - `Esc` cancels the entry (a: cancels the drag); in (b) with no entry it disarms and passes on (edit.escape);
// - case (b) disarms on any other key, which then reaches the keymap; an unfinished entry is **discarded** with the
//   help line "Entry discarded" (an entry applies only on Enter or Tab). Pointer moves beyond 3 px and clicks disarm
//   (b) too: the editor's capture bridge calls `disarm()` for them.
// Modifier keys alone never disarm. With `prefs.modeling.numericCapture: 'explicit'` nothing arms (only `T` and the
// card fields take numbers).
//
// The capture is created before the app exists (app/kernel.ts); `bindCapture` binds the app on first use (the runner
// and the built-ins call it), like `attachMeshes` for the mesh runtime.
import type { Disposer, ParamDef, ParamValue } from '@ekza-animator/anim-core';
import { isNumericParam } from '@ekza-animator/anim-core';
import type { EditorApp, LastRun, NumericCaptureApi, NumericCaptureState, NumericTarget } from '../types';
import { formatParamValue, numericParams, parseParamInput } from './paramInput';

/** Help-line text when case (b) disarms with an unfinished entry (§5.10). */
export const ENTRY_DISCARDED = 'Entry discarded';

const IDLE: NumericCaptureState = Object.freeze({ armed: null, field: null, text: null });

/** Keys that are only modifiers: they never start, end or disarm anything. */
const MODIFIER_CODES: ReadonlySet<string> = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'Fn',
  'OSLeft',
  'OSRight',
]);

const START = /^[0-9.-]$/;
/**
 * Characters of the §5.10 grammar after an entry started: numbers, operators, `%`, `°` and the letters of its units
 * (`m`, `cm`, `mm`, `deg`, `rad`, the exponent `e`). Any other letter is a key, not part of the entry.
 */
const CONTINUE = /^[0-9.,+\-*/=()%° acdegmrACDEGMR]$/;

export interface CaptureKeyEvent {
  readonly code: string;
  readonly key: string;
  readonly shift: boolean;
  readonly mod: boolean;
  readonly alt: boolean;
}

/** A message for the help line (the editor's capture bridge shows it). */
export interface CaptureMessage {
  readonly text: string;
  readonly tone: 'info' | 'warning';
}

/** The capture with its internal hooks (the public surface is `NumericCaptureApi`). */
export interface NumericCapture extends NumericCaptureApi {
  /** The bound app, null before `bindCapture`. */
  readonly app: EditorApp | null;
  /** The target's param definitions in Tab order (empty when idle). */
  fields(): readonly ParamDef[];
  /** Help-line messages ("Entry discarded", parse errors, committed values). */
  onMessage(listener: (message: CaptureMessage) => void): Disposer;
  subscribe(listener: (state: NumericCaptureState) => void): Disposer;
}

interface Armed {
  readonly reason: 'drag' | 'keyboard-op';
  readonly target: NumericTarget | 'last-run';
  readonly fields: readonly ParamDef[];
}

const captures = new WeakMap<NumericCaptureApi, { bind(app: EditorApp): void }>();

/** Binds the app to its capture (idempotent). */
export function bindCapture(app: EditorApp): void {
  captures.get(app.capture)?.bind(app);
}

export function createNumericCapture(): NumericCapture {
  let app: EditorApp | null = null;
  let state: NumericCaptureState = IDLE;
  let armed: Armed | null = null;
  const listeners = new Set<(state: NumericCaptureState) => void>();
  const messages = new Set<(message: CaptureMessage) => void>();

  const say = (text: string, tone: CaptureMessage['tone'] = 'info'): void => {
    for (const listener of Array.from(messages)) listener({ text, tone });
  };

  const setState = (next: NumericCaptureState): void => {
    if (next.armed === state.armed && next.field === state.field && next.text === state.text) return;
    state = Object.freeze({ ...next });
    if (app !== null) {
      const session = app.session.getState();
      app.session.setState({ model: { ...session.model, capture: state } });
    }
    for (const listener of Array.from(listeners)) listener(state);
  };

  const liveLastRun = (): LastRun | null => {
    const last = app?.session.getState().lastRun ?? null;
    return last !== null && last.closed === null ? last : null;
  };

  const defOf = (field: string | null): ParamDef | null =>
    field === null ? null : (armed?.fields.find((def) => def.name === field) ?? null);

  const currentValue = (field: string): ParamValue | undefined => {
    if (armed === null) return undefined;
    if (armed.target === 'last-run') return liveLastRun()?.args[field];
    return armed.target.value(field);
  };

  /** Parses the entry for the active field; null (with a message) when it does not parse. */
  const entryValue = (): { readonly field: string; readonly value: ParamValue } | null => {
    const def = defOf(state.field);
    if (def === null || state.text === null || state.field === null) return null;
    const parsed = parseParamInput(state.text, currentValue(state.field), def);
    if ('error' in parsed) {
      say(parsed.error, 'warning');
      return null;
    }
    if (parsed.problem !== null) say(parsed.problem, 'warning');
    return { field: state.field, value: parsed.value };
  };

  /**
   * Applies the entry to the target, then runs `done` (the key's follow-up: disarm, or the next field). False when the
   * entry did not parse (it stays for editing). A drag target takes the value at once. Case (b) applies through
   * `edit.adjustLast`: once the re-run finished the committed value is announced on the help line (the polite live
   * region, §5.10) and `done` runs; a refused or failed re-run reports its reason as a warning and keeps the entry, so
   * the user can correct it (§5.7 "A refusal of the re-run … reports the reason").
   */
  const applyEntry = (done: () => void): boolean => {
    if (state.text === null) {
      done();
      return true;
    }
    const entry = entryValue();
    if (entry === null || armed === null) return false;
    const def = defOf(entry.field);
    const target = armed.target;
    if (target !== 'last-run' || app === null) {
      if (target !== 'last-run' && typeof entry.value === 'number') target.set(entry.field, entry.value);
      if (def !== null) say(`${def.label} ${formatParamValue(def, entry.value)}`);
      setState({ ...state, text: null });
      done();
      return true;
    }
    const last = liveLastRun();
    const committed =
      def === null
        ? null
        : `${last === null ? '' : `${last.label} `}${def.label} ${formatParamValue(def, entry.value)}`;
    const entered = state;
    void app
      .runUntyped('edit.adjustLast', { args: { [entry.field]: entry.value } }, { source: 'keyboard' })
      .then((result) => {
        if (result.status !== 'finished') {
          say(result.status === 'cancelled' ? result.reason : result.error.message, 'warning');
          return;
        }
        if (committed !== null) say(committed);
        // Unless the window moved on while the re-run ran (another key, the card closed), the key's follow-up runs.
        if (state !== entered || armed?.target !== 'last-run') return;
        setState({ ...state, text: null });
        done();
      });
    return true;
  };

  const moveField = (delta: number): void => {
    if (armed === null || armed.fields.length === 0) return;
    const at = Math.max(
      0,
      armed.fields.findIndex((def) => def.name === state.field),
    );
    const next = armed.fields[(at + delta + armed.fields.length) % armed.fields.length];
    if (next !== undefined) setState({ ...state, field: next.name, text: null });
  };

  const disarmQuietly = (): void => {
    armed = null;
    setState(IDLE);
  };

  const capture: NumericCapture = {
    get app() {
      return app;
    },
    get state() {
      return state;
    },
    fields: () => armed?.fields ?? [],
    arm(reason, target) {
      if (app !== null && app.prefs.getState().modeling.numericCapture === 'explicit') return;
      if (target === 'last-run') {
        const last = liveLastRun();
        if (app !== null && last === null) return;
        const fields = numericParams(last?.params ?? []);
        const primary = fields[0];
        if (primary === undefined) return;
        armed = { reason, target, fields };
        setState({ armed: reason, field: primary.name, text: null });
        return;
      }
      const fields = target.fields.filter(isNumericParam);
      const active = fields.find((def) => def.name === target.active) ?? fields[0];
      armed = { reason, target, fields };
      setState({ armed: reason, field: active?.name ?? null, text: null });
    },
    disarm() {
      if (armed === null) return;
      const discarded = armed.reason === 'keyboard-op' && state.text !== null;
      disarmQuietly();
      if (discarded) say(ENTRY_DISCARDED, 'warning');
    },
    key(e: CaptureKeyEvent): boolean {
      if (armed === null) return false;
      if (MODIFIER_CODES.has(e.code)) return false;
      const keyboardOp = armed.reason === 'keyboard-op';
      if (keyboardOp && armed.target === 'last-run' && liveLastRun() === null && app !== null) {
        // The card closed under the window (another operation, a selection change): nothing to type into.
        capture.disarm();
        return false;
      }
      const plain = !e.mod && !e.alt;
      if (plain && e.key.length === 1) {
        if (state.text === null ? START.test(e.key) : CONTINUE.test(e.key)) {
          setState({ ...state, text: `${state.text ?? ''}${e.key}` });
          return true;
        }
      }
      switch (e.code) {
        case 'Backspace':
          if (state.text !== null && plain) {
            setState({ ...state, text: state.text.slice(0, -1) });
            return true;
          }
          break;
        case 'Tab':
          if (e.mod || e.alt) break;
          applyEntry(() => moveField(e.shift ? -1 : 1));
          return true;
        case 'Enter':
        case 'NumpadEnter': {
          if (e.mod || e.alt) break;
          const target = armed.target;
          applyEntry(() => {
            if (armed?.target !== target) return;
            if (!keyboardOp && target !== 'last-run') target.confirm();
            disarmQuietly();
          });
          return true;
        }
        case 'Escape':
          if (!keyboardOp && armed.target !== 'last-run') {
            const target = armed.target;
            disarmQuietly();
            target.cancel();
            return true;
          }
          if (state.text !== null) {
            setState({ ...state, text: null });
            return true;
          }
          disarmQuietly();
          return false;
        default:
          break;
      }
      // Any other key: case (b) ends (an unfinished entry is discarded) and the key reaches the keymap; during a
      // drag (a) the tool and the keymap get it as usual.
      if (keyboardOp) capture.disarm();
      return false;
    },
    openCard() {
      if (app === null) return;
      const last = liveLastRun();
      openLastOpCard(app, { expand: true, focusPrimary: true, paneId: last?.paneId ?? null });
    },
    onMessage(listener) {
      messages.add(listener);
      return () => {
        messages.delete(listener);
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  captures.set(capture, {
    bind(next: EditorApp): void {
      if (app === next) return;
      app = next;
      // Case (b) belongs to the live last operation: when the card closes, the window closes with it.
      next.session.subscribe((session) => {
        if (armed?.target !== 'last-run') return;
        const last = session.lastRun;
        if (last === null || last.closed !== null) capture.disarm();
      });
    },
  });
  return capture;
}

// ---------- the Last-op card's open state (per app; UI state, never in the document) ----------

export interface LastOpCardState {
  /** Expanded (fields shown) or a collapsed pill. */
  readonly expanded: boolean;
  /** ✕ hides the card; `lastRun` stays for `G` and `T` brings the card back. */
  readonly dismissed: boolean;
  /** Bumped by `T`: the card focuses `focusField` when it changes. */
  readonly focusSeq: number;
  readonly focusField: string | null;
  /** Pane whose card `T` opened (null: the pane of `lastRun`). */
  readonly paneId: string | null;
  /** Bumped for every new operation (not for its adjusted re-runs): a new card starts collapsed. */
  readonly generation: number;
}

const INITIAL_CARD: LastOpCardState = Object.freeze({
  expanded: false,
  dismissed: false,
  focusSeq: 0,
  focusField: null,
  paneId: null,
  generation: 0,
});

interface CardStore {
  state: LastOpCardState;
  readonly listeners: Set<() => void>;
}

const cards = new WeakMap<EditorApp, CardStore>();

function cardStore(app: EditorApp): CardStore {
  let store = cards.get(app);
  if (store === undefined) {
    store = { state: INITIAL_CARD, listeners: new Set() };
    cards.set(app, store);
  }
  return store;
}

function setCard(app: EditorApp, patch: Partial<LastOpCardState>): void {
  const store = cardStore(app);
  store.state = Object.freeze({ ...store.state, ...patch });
  for (const listener of Array.from(store.listeners)) listener();
}

/** The card's open state (a new operation resets it, its adjusted re-runs keep it). */
export function lastOpCardState(app: EditorApp): LastOpCardState {
  return cardStore(app).state;
}

/** `T` / Edit › Adjust Last Operation: shows and (optionally) expands the card and focuses its primary field. */
export function openLastOpCard(
  app: EditorApp,
  opts: { readonly expand: boolean; readonly focusPrimary: boolean; readonly paneId: string | null },
): void {
  const last = app.session.getState().lastRun;
  const primary = last === null ? null : (numericParams(last.params)[0]?.name ?? null);
  const current = cardStore(app).state;
  setCard(app, {
    expanded: opts.expand || current.expanded,
    dismissed: false,
    focusSeq: opts.focusPrimary ? current.focusSeq + 1 : current.focusSeq,
    focusField: opts.focusPrimary ? primary : current.focusField,
    paneId: opts.paneId,
  });
}

/** Expands or collapses the card (a click on the pill). */
export function setLastOpCardExpanded(app: EditorApp, expanded: boolean): void {
  setCard(app, { expanded, dismissed: false });
}

/** ✕: hides the card (lastRun stays for `G`; `T` brings it back). */
export function dismissLastOpCard(app: EditorApp): void {
  setCard(app, { dismissed: true, expanded: false });
}

/** A new operation (the LastRun recorder; adjusted re-runs keep the card as it is): collapsed, shown. */
export function resetLastOpCard(app: EditorApp): void {
  const current = cardStore(app).state;
  setCard(app, { ...INITIAL_CARD, focusSeq: current.focusSeq, generation: current.generation + 1 });
}

export function subscribeLastOpCard(app: EditorApp, listener: () => void): Disposer {
  const store = cardStore(app);
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

// ---------- the selected INPUTS field name (§8.6; the viewport MMB-drag runs its virtual slider, §5.15) ----------

/** A Channel Box INPUTS field name the user selected (B12a's MMB rule drags it). */
export interface InputsFieldSelection {
  /** 'lastop': the last-op entry (`edit.adjustLast`); 'primitive': the primitive entry of `mesh`. */
  readonly entry: 'lastop' | 'primitive';
  readonly mesh: string;
  readonly param: string;
}

const inputsFields = new WeakMap<
  EditorApp,
  { value: InputsFieldSelection | null; readonly listeners: Set<() => void> }
>();

function inputsStore(app: EditorApp): { value: InputsFieldSelection | null; readonly listeners: Set<() => void> } {
  let store = inputsFields.get(app);
  if (store === undefined) {
    store = { value: null, listeners: new Set() };
    inputsFields.set(app, store);
  }
  return store;
}

/** The selected INPUTS field name, null when none (a viewport MMB drag then follows the other rules of §5.15). */
export function selectedInputsField(app: EditorApp): InputsFieldSelection | null {
  return inputsStore(app).value;
}

/** Selects (or clears with null) an INPUTS field name; selecting it again clears it. */
export function selectInputsField(app: EditorApp, field: InputsFieldSelection | null): void {
  const store = inputsStore(app);
  const current = store.value;
  const same =
    current !== null &&
    field !== null &&
    current.entry === field.entry &&
    current.mesh === field.mesh &&
    current.param === field.param;
  store.value = same ? null : field;
  for (const listener of Array.from(store.listeners)) listener();
}

export function subscribeInputsField(app: EditorApp, listener: () => void): Disposer {
  const store = inputsStore(app);
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}
