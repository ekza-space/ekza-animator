// Probe set for the "Animate resolves exactly as on M2a" check (M6A-SPEC §9 B0b DoD): every physical key the editor
// could bind, under every modifier combination a binding can name, over every Animate scope chain and trigger. The
// recorded M2a answers live in `keymap-m2a-resolve.json` (generated once from the M2a default keymap table; never
// regenerate it from a changed keymap).
import { GLOBAL_SCOPE, type KeyInput, type KeymapManager, type KeyScope, type KeyTrigger, PANEL } from '../src';

const LETTERS = Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`);
const DIGITS = Array.from({ length: 10 }, (_, i) => `Digit${i}`);
const F_KEYS = Array.from({ length: 12 }, (_, i) => `F${i + 1}`);
const NAMED = [
  'Space',
  'Escape',
  'Enter',
  'NumpadEnter',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Comma',
  'Period',
  'Slash',
  'Backslash',
  'Minus',
  'Equal',
  'Semicolon',
  'Quote',
  'BracketLeft',
  'BracketRight',
  'Backquote',
];

/** Every probed `KeyboardEvent.code`. */
export const PROBE_CODES: readonly string[] = [...LETTERS, ...DIGITS, ...F_KEYS, ...NAMED];

/** Modifier sets as the user presses them: `mod` is the platform's command key, `ctrl` the literal Control key. */
export interface ProbeMods {
  readonly mod?: boolean;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

export const PROBE_MODS: readonly ProbeMods[] = [
  {},
  { shift: true },
  { alt: true },
  { mod: true },
  { mod: true, shift: true },
  { mod: true, alt: true },
  { alt: true, shift: true },
  { ctrl: true },
  { ctrl: true, alt: true },
  { ctrl: true, shift: true },
  { mod: true, alt: true, shift: true },
];

/** The panels Animate shipped with on M2a (the recorded answers cover these; the Model-only panel kinds `PANEL` gained
 *  at the M6a INT, M6A-B9-13, are never docked in Animate). */
const M2A_PANELS: readonly string[] = [
  PANEL.viewport,
  PANEL.graph,
  PANEL.timeline,
  PANEL.outliner,
  PANEL.clips,
  PANEL.channelBox,
  PANEL.attributes,
  PANEL.dopeSheet,
];

/** Animate's scope chains: the shipped `<panel>` → `global` and the pointer outside every panel. */
export const ANIMATE_CHAINS: readonly (readonly KeyScope[])[] = [
  [GLOBAL_SCOPE],
  ...M2A_PANELS.map((panel) => [panel, GLOBAL_SCOPE]),
];

export const TRIGGERS: readonly KeyTrigger[] = ['press', 'tap', 'hold'];

export function probeInput(code: string, mods: ProbeMods, platform: 'mac' | 'other'): KeyInput {
  const mod = mods.mod === true;
  const ctrl = mods.ctrl === true;
  return {
    code,
    ctrlKey: ctrl || (platform === 'other' && mod),
    metaKey: platform === 'mac' && mod,
    shiftKey: mods.shift === true,
    altKey: mods.alt === true,
    repeat: false,
  };
}

const modsText = (mods: ProbeMods): string =>
  (['mod', 'ctrl', 'alt', 'shift'] as const).filter((name) => mods[name] === true).join('+') || '-';

/** One line per probe that resolves: `platform code mods chain trigger → op args@scope`. */
export function resolveTable(keymap: KeymapManager, platform: 'mac' | 'other'): string[] {
  const lines: string[] = [];
  for (const code of PROBE_CODES) {
    for (const mods of PROBE_MODS) {
      const input = probeInput(code, mods, platform);
      for (const chain of ANIMATE_CHAINS) {
        for (const trigger of TRIGGERS) {
          const binding = keymap.resolve(input, chain, trigger);
          if (binding === null) continue;
          const args = binding.args === undefined ? '' : ` ${JSON.stringify(binding.args)}`;
          lines.push(
            `${platform} ${code} ${modsText(mods)} ${chain[0]} ${trigger} → ${binding.op}${args}@${binding.scope}`,
          );
        }
      }
    }
  }
  return lines;
}
