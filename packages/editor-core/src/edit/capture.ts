// Numeric capture window and the Last-op card's open state (M6A-SPEC §5.10, §5.7 `T`, §8.6; B11).
//
// `app.capture` is an eager **shim** (§5.27: the eager route holds descriptors, registrations, keymap rows and shell
// code): it owns the state (mirrored to `session.model.capture`), the listeners and the app binding, and answers
// `key()` with false while nothing is armed. The state machine (what is armed, what each key does, the typed-value
// grammar) is ./captureEngine.ts, which loads with the B11 runtime chunk (`loadOpsRuntime`: the first Model entry, a
// recorded LastRun, an arm, an adjust). An `arm` before the chunk has loaded arms once it has (when what it armed for
// is still current); in the editor the chunk loads on entering Model, before any operation can arm the window.
//
// The capture is created before the app exists (app/kernel.ts); `bindCapture` binds the app on first use (the runner
// and the built-ins call it), like `attachMeshes` for the mesh runtime.
import { type Disposer, isNumericParam, type ParamDef, primaryParam } from '@ekza-studio/anim-core';
import { loadOpsRuntime, opsRuntime } from '../operators/builtin/lastop';
import type { EditorApp, LastRun, NumericCaptureApi, NumericCaptureState } from '../types';
import type { CaptureEngine } from './captureEngine';

/** Help-line text when case (b) disarms with an unfinished entry (§5.10). */
export const ENTRY_DISCARDED = 'Entry discarded';

/** Nothing armed. */
export const IDLE_CAPTURE: NumericCaptureState = Object.freeze({ armed: null, field: null, text: null });

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

/** What the lazy engine reads and writes through (the shim's state, messages and app). */
export interface CaptureHost {
  readonly app: EditorApp | null;
  state(): NumericCaptureState;
  setState(next: NumericCaptureState): void;
  say(text: string, tone?: CaptureMessage['tone']): void;
}

const captures = new WeakMap<NumericCaptureApi, { bind(app: EditorApp): void }>();

/** Binds the app to its capture (idempotent). */
export function bindCapture(app: EditorApp): void {
  captures.get(app.capture)?.bind(app);
}

const liveLastRunOf = (app: EditorApp | null): LastRun | null => {
  const last = app?.session.getState().lastRun ?? null;
  return last !== null && last.closed === null ? last : null;
};

export function createNumericCapture(): NumericCapture {
  let app: EditorApp | null = null;
  let state: NumericCaptureState = IDLE_CAPTURE;
  let engine: CaptureEngine | null = null;
  /** Bumped by every arm/disarm: an arm waiting for the chunk applies only when nothing happened since. */
  let armSeq = 0;
  const listeners = new Set<(state: NumericCaptureState) => void>();
  const messages = new Set<(message: CaptureMessage) => void>();

  const host: CaptureHost = {
    get app() {
      return app;
    },
    state: () => state,
    setState(next) {
      if (next.armed === state.armed && next.field === state.field && next.text === state.text) return;
      state = Object.freeze({ ...next });
      if (app !== null) {
        const session = app.session.getState();
        app.session.setState({ model: { ...session.model, capture: state } });
      }
      for (const listener of Array.from(listeners)) listener(state);
    },
    say(text, tone = 'info') {
      for (const listener of Array.from(messages)) listener({ text, tone });
    },
  };

  /** The engine once the runtime chunk has loaded (created on first use), else null. */
  const engineNow = (): CaptureEngine | null => {
    if (engine === null) {
      const runtime = opsRuntime();
      if (runtime !== null) engine = runtime.capture.createCaptureEngine(host);
    }
    return engine;
  };

  const capture: NumericCapture = {
    get app() {
      return app;
    },
    get state() {
      return state;
    },
    fields: () => engine?.fields() ?? [],
    arm(reason, target) {
      armSeq++;
      const now = engineNow();
      if (now !== null) {
        now.arm(reason, target);
        return;
      }
      if (app !== null && app.prefs.getState().modeling.numericCapture === 'explicit') return;
      const last = target === 'last-run' ? liveLastRunOf(app) : null;
      if (target === 'last-run' && (app === null || last === null)) return;
      const seq = armSeq;
      void loadOpsRuntime().then(
        () => {
          // Arms only for what it was asked: nothing else armed or disarmed, the same live last operation.
          if (armSeq !== seq || (target === 'last-run' && liveLastRunOf(app) !== last)) return;
          engineNow()?.arm(reason, target);
        },
        () => {
          // The chunk did not load (offline after a redeploy): the window stays closed; the card still takes numbers.
        },
      );
    },
    disarm() {
      armSeq++;
      engine?.disarm();
    },
    key(e: CaptureKeyEvent): boolean {
      return state.armed === null || engine === null ? false : engine.key(e);
    },
    openCard() {
      if (app === null) return;
      const last = liveLastRunOf(app);
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
      next.session.subscribe((session, previous) => {
        engine?.sessionChanged(session);
        // The B11 runtime chunk loads with the Model workspace (§5.27), before an operation can arm the window.
        if (session.workspace === 'model' && previous.workspace !== 'model') void loadOpsRuntime().catch(() => {});
      });
      if (next.session.getState().workspace === 'model') void loadOpsRuntime().catch(() => {});
    },
  });
  return capture;
}

// ---------- the fields of a parameter list (eager: the card facade decides from them whether a card shows) ----------

/**
 * The fields the Last-op card, INPUTS and option boxes show (§8.6): value-bound, not hidden, not `data`; the primary
 * field first, the others in list order.
 */
export function visibleParams(params: readonly ParamDef[] | undefined): readonly ParamDef[] {
  if (params === undefined) return [];
  const shown = params.filter((def) => def.hidden !== true && def.kind !== 'data' && def.bound === 'value');
  const primary = primaryParam(shown);
  return primary === null ? shown : [primary, ...shown.filter((def) => def !== primary)];
}

/** Fields the numeric capture moves through (Tab order): the visible numeric params, primary first. */
export function numericParams(params: readonly ParamDef[] | undefined): readonly ParamDef[] {
  return visibleParams(params).filter(isNumericParam);
}

/** The primary visible param, else null (operations without one never arm the capture window). */
export function primaryVisibleParam(params: readonly ParamDef[] | undefined): ParamDef | null {
  const shown = visibleParams(params);
  return primaryParam(shown);
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
