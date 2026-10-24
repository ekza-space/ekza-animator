// Shared helpers of the B0b keymap tests (M6A-SPEC §7, §5.17).
import {
  type Chord,
  type ComponentMode,
  type KeyBinding,
  type KeyScope,
  keyScopeChain,
  DCC_KEYMAP,
  PANEL,
  resolveChord,
} from '../src';
import { createKeymapManager, type KernelKeymap } from '../src/keymap/manager';

/** `'Mod+Shift+KeyE'` → `{ code: 'KeyE', mod: true, shift: true }` (`Ctrl` is the literal Control key). */
export function ch(text: string): Chord {
  const parts = text.split('+');
  const code = parts.pop() ?? '';
  const chord: { code: string; mod?: true; shift?: true; alt?: true; ctrl?: true } = { code };
  for (const part of parts) {
    if (part === 'Mod') chord.mod = true;
    else if (part === 'Shift') chord.shift = true;
    else if (part === 'Alt') chord.alt = true;
    else if (part === 'Ctrl') chord.ctrl = true;
    else throw new Error(`unknown modifier ${part} in ${text}`);
  }
  return chord;
}

export function dccKeymap(platform: 'mac' | 'other' = 'other'): KernelKeymap {
  const keymap = createKeymapManager(platform);
  keymap.add(DCC_KEYMAP);
  return keymap;
}

/** The chain over a Model panel (`null` = outside every panel); the viewport takes the component mode. */
export function modelChain(panel: string | null, mode: ComponentMode = 'object'): KeyScope[] {
  return keyScopeChain({ workspace: 'model', panel, viewport: panel === PANEL.viewport, mode });
}

export function animateChain(panel: string | null): KeyScope[] {
  return keyScopeChain({ workspace: null, panel, viewport: panel === PANEL.viewport, mode: 'object' });
}

/** Every chain a key resolves over in Model: no panel, each panel, and the viewport in each mode. */
export function allModelChains(panels: readonly string[] = Object.values(PANEL)): KeyScope[][] {
  const chains: KeyScope[][] = [modelChain(null)];
  for (const panel of panels) {
    if (panel !== PANEL.viewport) chains.push(modelChain(panel));
    else for (const mode of ['object', 'vertex', 'edge', 'face'] as const) chains.push(modelChain(panel, mode));
  }
  return chains;
}

export function allAnimateChains(panels: readonly string[] = Object.values(PANEL)): KeyScope[][] {
  return [animateChain(null), ...panels.map(animateChain)];
}

export interface Resolved {
  readonly op: string;
  readonly args?: unknown;
  readonly scope: string;
}

export function resolved(
  keymap: KernelKeymap,
  chord: string,
  scopes: readonly KeyScope[],
  trigger: 'press' | 'tap' | 'hold' = 'press',
): Resolved | null {
  const binding: KeyBinding | null = resolveChord(keymap, ch(chord), scopes, trigger);
  if (binding === null) return null;
  return binding.args === undefined
    ? { op: binding.op, scope: binding.scope }
    : { op: binding.op, args: binding.args, scope: binding.scope };
}

/** Order-independent JSON of operator arguments. */
export function stableKeyOf(value: unknown): string {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableKeyOf).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableKeyOf(record[key])}`)
    .join(',')}}`;
}

export function sameChord(a: Chord, b: Chord): boolean {
  return (
    a.code === b.code &&
    (a.mod === true) === (b.mod === true) &&
    (a.shift === true) === (b.shift === true) &&
    (a.alt === true) === (b.alt === true) &&
    (a.ctrl === true) === (b.ctrl === true)
  );
}
