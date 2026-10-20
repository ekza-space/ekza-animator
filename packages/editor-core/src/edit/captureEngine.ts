// The numeric capture window's state machine (M6A-SPEC §5.10; B11) — the lazy half of `app.capture` (§5.27: the eager
// route holds only the shim in ./capture.ts; this module loads with the B11 runtime chunk on the first Model entry or
// on first need, `loadOpsRuntime`). The shim owns the state, the listeners and the app binding; the engine owns what
// is armed and what the keys do.
//
// Armed (a) during an active drag of a tool, manipulator or card virtual slider (the tool's `NumericTarget`, active
// field = the dragged field) and (b) right after an operator invoked from the keyboard finishes with a live `lastRun`
// that has a primary param (the Last-op card, active field = the primary). While armed the keyboard adapter offers
// keydowns to `key()` before anything else (§5.17 step 1):
// - a digit, `.` or `-` starts an entry for the active field (then the grammar's other characters extend it); a digit
//   consumed this way never also switches mode or shading;
// - `Backspace` edits the entry (erased to nothing it still holds the keys: an extra `Backspace` never reaches the
//   keymap's Delete); `Tab`/`Shift+Tab` apply it and move between the target's fields;
// - `Enter` applies (a: confirms the drag with the typed value; b: `edit.adjustLast {[field]: value}`, announced once the
//   re-run finished; a refusal is reported and brings the entry back) and disarms; `Enter` with no entry — none typed,
//   or one erased to nothing (except a nullable field's, where nothing means "auto") — confirms the drag (a) or is a
//   no-op that disarms (b). An accepted entry leaves the window at once: keys typed while its re-run runs start a new
//   entry instead of extending the committed one;
// - `Esc` cancels the entry (a: cancels the drag); in (b) with no entry it disarms and passes on (edit.escape);
// - case (b) disarms on any other key, which then reaches the keymap; an unfinished entry is **discarded** with the
//   help line "Entry discarded" (an entry applies only on Enter or Tab). Pointer moves beyond 3 px and clicks disarm
//   (b) too: the editor's capture bridge calls `disarm()` for them.
// Modifier keys alone never disarm. With `prefs.modeling.numericCapture: 'explicit'` nothing arms (only `T` and the
// card fields take numbers).
import { isNumericParam, type ParamDef, type ParamValue } from '@ekza-animator/anim-core';
import type { LastRun, NumericCaptureApi, NumericCaptureState, NumericTarget, SessionState } from '../types';
import { type CaptureHost, type CaptureKeyEvent, ENTRY_DISCARDED, IDLE_CAPTURE, numericParams } from './capture';
import { formatParamValue, parseParamInput } from './paramInput';

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

/** What the shim delegates to once the runtime chunk has loaded. */
export interface CaptureEngine {
  fields(): readonly ParamDef[];
  arm: NumericCaptureApi['arm'];
  disarm(): void;
  key(e: CaptureKeyEvent): boolean;
  /** The session changed: case (b) closes with the card. */
  sessionChanged(session: SessionState): void;
}

interface Armed {
  readonly reason: 'drag' | 'keyboard-op';
  readonly target: NumericTarget | 'last-run';
  readonly fields: readonly ParamDef[];
}

export function createCaptureEngine(host: CaptureHost): CaptureEngine {
  let armed: Armed | null = null;
  const state = (): NumericCaptureState => host.state();
  const setState = (next: NumericCaptureState): void => host.setState(next);
  const say = (text: string, tone?: 'info' | 'warning'): void => host.say(text, tone);

  const liveLastRun = (): LastRun | null => {
    const last = host.app?.session.getState().lastRun ?? null;
    return last !== null && last.closed === null ? last : null;
  };

  const defOf = (field: string | null): ParamDef | null =>
    field === null ? null : (armed?.fields.find((def) => def.name === field) ?? null);

  const currentValue = (field: string): ParamValue | undefined => {
    if (armed === null) return undefined;
    if (armed.target === 'last-run') return liveLastRun()?.args[field];
    return armed.target.value(field);
  };

  /**
   * Whether the window holds an entry to apply: typed text, or text erased to nothing for a nullable field (nothing
   * there means "auto"). Text erased to nothing elsewhere is no entry (Enter disarms case (b), nothing is discarded).
   */
  const hasEntry = (): boolean => {
    const { field, text } = state();
    if (text === null) return false;
    return text !== '' || defOf(field)?.nullable === true;
  };

  /** Parses the entry for the active field; null (with a message) when it does not parse. */
  const entryValue = (): { readonly field: string; readonly value: ParamValue } | null => {
    const { field, text } = state();
    const def = defOf(field);
    if (def === null || text === null || field === null) return null;
    const parsed = parseParamInput(text, currentValue(field), def);
    if ('error' in parsed) {
      say(parsed.error, 'warning');
      return null;
    }
    if (parsed.problem !== null) say(parsed.problem, 'warning');
    return { field, value: parsed.value };
  };

  /**
   * Applies the entry to the target, then runs `done` (the key's follow-up: disarm, or the next field). False when the
   * entry did not parse (it stays for editing). A drag target takes the value at once. Case (b) applies through
   * `edit.adjustLast`: once the re-run finished the committed value is announced on the help line (the polite live
   * region, §5.10) and `done` runs; a refused or failed re-run reports its reason as a warning and brings the entry
   * back, so the user can correct it (§5.7 "A refusal of the re-run … reports the reason").
   */
  const applyEntry = (done: () => void): boolean => {
    if (!hasEntry()) {
      if (state().text !== null) setState({ ...state(), text: null });
      done();
      return true;
    }
    const entry = entryValue();
    if (entry === null || armed === null) return false;
    const def = defOf(entry.field);
    const target = armed.target;
    const app = host.app;
    if (target !== 'last-run' || app === null) {
      if (target !== 'last-run' && typeof entry.value === 'number') target.set(entry.field, entry.value);
      if (def !== null) say(`${def.label} ${formatParamValue(def, entry.value)}`);
      setState({ ...state(), text: null });
      done();
      return true;
    }
    const last = liveLastRun();
    const committed =
      def === null
        ? null
        : `${last === null ? '' : `${last.label} `}${def.label} ${formatParamValue(def, entry.value)}`;
    // The entry is accepted: it leaves the window now (keys typed during the re-run start a new entry; a pointer move
    // meanwhile discards nothing). A refusal brings it back unless the window moved on.
    const text = state().text;
    setState({ ...state(), text: null });
    const accepted = state();
    void app
      .runUntyped('edit.adjustLast', { args: { [entry.field]: entry.value } }, { source: 'keyboard' })
      .then((result) => {
        if (result.status !== 'finished') {
          say(result.status === 'cancelled' ? result.reason : result.error.message, 'warning');
          if (state() === accepted && armed?.target === 'last-run') setState({ ...state(), field: entry.field, text });
          return;
        }
        if (committed !== null) say(committed);
        // Unless the window moved on while the re-run ran (another key, the card closed), the key's follow-up runs.
        if (state() !== accepted || armed?.target !== 'last-run') return;
        done();
      });
    return true;
  };

  const moveField = (delta: number): void => {
    if (armed === null || armed.fields.length === 0) return;
    const at = Math.max(
      0,
      armed.fields.findIndex((def) => def.name === state().field),
    );
    const next = armed.fields[(at + delta + armed.fields.length) % armed.fields.length];
    if (next !== undefined) setState({ ...state(), field: next.name, text: null });
  };

  const disarmQuietly = (): void => {
    armed = null;
    setState(IDLE_CAPTURE);
  };

  const engine: CaptureEngine = {
    fields: () => armed?.fields ?? [],
    arm(reason, target) {
      const app = host.app;
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
      const discarded = armed.reason === 'keyboard-op' && hasEntry();
      disarmQuietly();
      if (discarded) say(ENTRY_DISCARDED, 'warning');
    },
    key(e: CaptureKeyEvent): boolean {
      if (armed === null) return false;
      if (MODIFIER_CODES.has(e.code)) return false;
      const keyboardOp = armed.reason === 'keyboard-op';
      if (keyboardOp && armed.target === 'last-run' && liveLastRun() === null && host.app !== null) {
        // The card closed under the window (another operation, a selection change): nothing to type into.
        engine.disarm();
        return false;
      }
      const plain = !e.mod && !e.alt;
      const { text } = state();
      if (plain && e.key.length === 1) {
        if (text === null ? START.test(e.key) : CONTINUE.test(e.key)) {
          setState({ ...state(), text: `${text ?? ''}${e.key}` });
          return true;
        }
      }
      switch (e.code) {
        case 'Backspace':
          if (text !== null && plain) {
            setState({ ...state(), text: text.slice(0, -1) });
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
          if (text !== null) {
            setState({ ...state(), text: null });
            return true;
          }
          disarmQuietly();
          return false;
        default:
          break;
      }
      // Any other key: case (b) ends (an unfinished entry is discarded) and the key reaches the keymap; during a
      // drag (a) the tool and the keymap get it as usual.
      if (keyboardOp) engine.disarm();
      return false;
    },
    sessionChanged(session) {
      // Case (b) belongs to the live last operation: when the card closes, the window closes with it.
      if (armed?.target !== 'last-run') return;
      const last = session.lastRun;
      if (last === null || last.closed !== null) engine.disarm();
    },
  };
  return engine;
}
