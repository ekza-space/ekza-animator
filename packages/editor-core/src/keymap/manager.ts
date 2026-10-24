// Keymap manager (ADR 0008 §5, MVP-SPEC §4.10): bindings on `KeyboardEvent.code` with a platform `mod`, resolved
// against a scope chain (panel under the pointer first, then 'global') and a trigger ('press', or 'tap'/'hold' for
// tap-hold keys whose timing the DOM adapter measures).
//
// Precedence on the same chord, scope and trigger: user overrides > preference bindings (e.g. Space = play) >
// contributions, the latest contribution first (so the `dcc` preset, contributed by the built-ins, is the base).
import type { Disposer } from '@ekza-studio/anim-core';
import type { Chord, KeyBinding, KeyInput, KeymapManager, KeyScope, KeyTrigger, OperatorId } from '../types';
import { chordLabel } from './labels';
import { MODEL_SCOPE } from './scopes';

type TapHoldMods = Parameters<KeymapManager['isTapHoldKey']>[2];

/** Operators that keep firing while their key auto-repeats (stepping, nudging, undo/redo); others fire once. */
const REPEATABLE: ReadonlySet<OperatorId> = new Set<OperatorId>([
  'time.step',
  'time.nextKey',
  'time.prevKey',
  'view.manipulatorSize',
  'edit.undo',
  'edit.redo',
  // M6a (§5.6): a held grow/shrink key keeps growing; the history coalesces the repeats into one step.
  'select.mesh.grow',
  'select.mesh.shrink',
]);

/**
 * Keys whose binding depends on how long they are held (200 ms, measured by the DOM adapter), M6A-SPEC §5.17: `Space`
 * in every scope with any modifiers (as shipped); `KeyB` only unmodified with the Model viewport in the chain (tap =
 * soft select; a pointer-down while it is held makes it a hold, the radius drag). Every other key is never deferred,
 * so tools see `X`/`V`/`J`/`D`/`I` as plain down/up holds and `Mod+B`, Graph `B` resolve on press as before.
 */
function isTapHoldKey(code: string, scopes: readonly KeyScope[], mods: TapHoldMods): boolean {
  if (code === 'Space') return true;
  return (
    code === 'KeyB' && !mods.mod && !mods.shift && !mods.alt && !mods.ctrl && scopes.includes(MODEL_SCOPE.viewport)
  );
}

export interface KernelKeymap extends KeymapManager {
  /** A keymap contribution (`app.contribute({kind: 'keymap'})`); the disposer removes it. */
  add(bindings: readonly KeyBinding[]): Disposer;
  /** Bindings derived from preferences (Space behaviour); replaced as a whole. */
  setPreferenceBindings(bindings: readonly KeyBinding[]): void;
}

export function createKeymapManager(
  platform: 'mac' | 'other',
  opts?: {
    /** Called when `setOverrides` changes the user overrides (the app persists them in preferences). */
    readonly onOverrides?: (bindings: readonly KeyBinding[]) => void;
  },
): KernelKeymap {
  let overrides: readonly KeyBinding[] = [];
  let preference: readonly KeyBinding[] = [];
  const contributed: (readonly KeyBinding[])[] = [];
  /** Bindings in precedence order (highest first); rebuilt when a layer changes. */
  let ordered: readonly KeyBinding[] | null = null;

  const precedence = (): readonly KeyBinding[] => {
    ordered ??= [...overrides, ...preference, ...[...contributed].reverse().flat()];
    return ordered;
  };

  const matches = (chord: Chord, input: KeyInput): boolean => {
    const wantMeta = platform === 'mac' && chord.mod === true;
    const wantCtrl = platform === 'mac' ? chord.ctrl === true : chord.mod === true || chord.ctrl === true;
    return (
      chord.code === input.code &&
      input.metaKey === wantMeta &&
      input.ctrlKey === wantCtrl &&
      input.shiftKey === (chord.shift === true) &&
      input.altKey === (chord.alt === true)
    );
  };

  return {
    platform,
    preset: 'dcc',
    bindings: () => [...contributed.flat(), ...preference, ...overrides],
    resolve(input: KeyInput, scopes: readonly KeyScope[], trigger: KeyTrigger): KeyBinding | null {
      const candidates = precedence();
      for (const scope of scopes) {
        for (const binding of candidates) {
          if (binding.scope !== scope || (binding.trigger ?? 'press') !== trigger) continue;
          if (!matches(binding.chord, input)) continue;
          // An auto-repeated keydown fires only repeatable operators; a shadowed binding is not consulted.
          return input.repeat && !REPEATABLE.has(binding.op) ? null : binding;
        }
      }
      return null;
    },
    isTapHoldKey,
    label: (chord: Chord) => chordLabel(chord, platform),
    setOverrides(bindings: readonly KeyBinding[]): void {
      overrides = Object.freeze([...bindings]);
      ordered = null;
      opts?.onOverrides?.(overrides);
    },
    add(bindings: readonly KeyBinding[]): Disposer {
      const entry = Object.freeze([...bindings]);
      contributed.push(entry);
      ordered = null;
      return () => {
        const index = contributed.indexOf(entry);
        if (index === -1) return;
        contributed.splice(index, 1);
        ordered = null;
      };
    },
    setPreferenceBindings(bindings: readonly KeyBinding[]): void {
      preference = Object.freeze([...bindings]);
      ordered = null;
    },
  };
}

/** Bindings implied by preferences: `spaceBehaviour: 'play'` turns a Space tap into play/stop (§4.10). */
export function preferenceBindings(spaceBehaviour: 'maximize' | 'play'): readonly KeyBinding[] {
  return spaceBehaviour === 'play'
    ? [{ chord: { code: 'Space' }, op: 'time.togglePlay', scope: 'global', trigger: 'tap' }]
    : [];
}
