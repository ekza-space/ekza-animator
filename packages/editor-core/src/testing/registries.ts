// Contribution registries, tool registry and keymap manager of the fake app (ADR 0008; MVP-SPEC §4.5).
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import type {
  Chord,
  KeyBinding,
  KeyInput,
  KeymapManager,
  KeyScope,
  KeyTrigger,
  PanelKind,
  Registry,
  ToolDef,
  ToolId,
  ToolRegistry,
} from '../types';

/** Registration-ordered registry; a duplicate id throws, disposing removes only the registered definition. */
export function createRegistry<T extends { readonly id: string }>(kind: string): Registry<T> {
  const items = new Map<string, T>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    register(def: T): Disposer {
      if (items.has(def.id)) throw new EkzaError('unsupported', `${kind} '${def.id}' is already registered`);
      items.set(def.id, def);
      notify();
      return () => {
        if (items.get(def.id) !== def) return;
        items.delete(def.id);
        notify();
      };
    },
    get: (id: string) => items.get(id),
    list: () => [...items.values()],
    subscribe(listener: () => void): Disposer {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDef>();
  const keyOf = (panel: PanelKind, id: ToolId): string => `${panel}\u0000${id}`;
  return {
    register<H>(def: ToolDef<H>): Disposer {
      const key = keyOf(def.panel, def.id);
      if (tools.has(key)) throw new EkzaError('unsupported', `Tool '${def.panel}/${def.id}' is already registered`);
      const stored = def as unknown as ToolDef;
      tools.set(key, stored);
      return () => {
        if (tools.get(key) === stored) tools.delete(key);
      };
    },
    get: (panel: PanelKind, id: ToolId) => tools.get(keyOf(panel, id)),
    list: (panel: PanelKind) => [...tools.values()].filter((tool) => tool.panel === panel),
  };
}

/**
 * Keymap manager over a binding list: overrides first, then contributed bindings, then the preset. `mod` is Cmd on
 * macOS and Ctrl elsewhere; a chord matches only with exactly its modifiers.
 */
export interface FakeKeymap extends KeymapManager {
  /** Adds bindings (keymap contributions); the disposer removes them. */
  add(bindings: readonly KeyBinding[]): Disposer;
}

export function createKeymap(platform: 'mac' | 'other', preset: readonly KeyBinding[]): FakeKeymap {
  let overrides: readonly KeyBinding[] = [];
  const contributed: (readonly KeyBinding[])[] = [];
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
  const ordered = (): KeyBinding[] => [...overrides, ...contributed.flat(), ...preset];
  return {
    platform,
    preset: 'maya',
    bindings: () => [...preset, ...contributed.flat(), ...overrides],
    resolve(input: KeyInput, scopes: readonly KeyScope[], trigger: KeyTrigger): KeyBinding | null {
      const candidates = ordered();
      for (const scope of scopes) {
        const hit = candidates.find(
          (binding) =>
            binding.scope === scope && (binding.trigger ?? 'press') === trigger && matches(binding.chord, input),
        );
        if (hit !== undefined) return hit;
      }
      return null;
    },
    isTapHoldKey: (code: string) => code === 'Space',
    label(chord: Chord): string {
      const key = keyName(chord.code);
      if (platform === 'mac') {
        return `${chord.ctrl === true ? '⌃' : ''}${chord.alt === true ? '⌥' : ''}${chord.shift === true ? '⇧' : ''}${chord.mod === true ? '⌘' : ''}${key}`;
      }
      const parts = [chord.mod === true || chord.ctrl === true ? 'Ctrl' : null, chord.alt === true ? 'Alt' : null];
      parts.push(chord.shift === true ? 'Shift' : null, key);
      return parts.filter((part) => part !== null).join('+');
    },
    setOverrides(bindings: readonly KeyBinding[]): void {
      overrides = [...bindings];
    },
    add(bindings: readonly KeyBinding[]): Disposer {
      const entry = [...bindings];
      contributed.push(entry);
      return () => {
        const index = contributed.indexOf(entry);
        if (index !== -1) contributed.splice(index, 1);
      };
    },
  };
}

function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
