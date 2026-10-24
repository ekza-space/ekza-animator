// B0b DoD (M6A-SPEC §9): Animate's shipped bindings resolve exactly as before. `keymap-m2a-resolve.json` records what
// the M2a default keymap table (v0.2.0) answered for every probe of `keymap-probes.ts` (each physical key under each
// modifier set, over every Animate scope chain and trigger, on both platforms). Today's keymap must give the same
// answers, except for the changes the spec names for Animate.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dccKeymap } from './keymap-support';
import { resolveTable } from './keymap-probes';

const M2A: readonly string[] = JSON.parse(
  readFileSync(new URL('./keymap-m2a-resolve.json', import.meta.url), 'utf8'),
) as string[];

/**
 * Answers the spec adds in Animate (§3 rule 10 and the global §7 rows): `Mod+Shift+E` opens Export everywhere, `R`
 * picks the viewport Scale tool, `4`–`7` set the pane shading, `Mod+K` opens the command palette. Each pattern must
 * match at least one new answer, and every new answer must match one.
 */
const NAMED_CHANGES: readonly RegExp[] = [
  // `ctrl` is Mod on Windows and Linux, so it answers there too; on macOS only Cmd does.
  /^(other KeyE (mod|ctrl)|mac KeyE mod)\+shift \w+ press → ui\.open \{"dialog":"export"\}@global$/,
  /^(other|mac) KeyR - viewport press → view\.tool \{"panel":"viewport","tool":"scale"\}@viewport$/,
  /^(other|mac) Digit[4-7] - viewport press → view\.shading \{"mode":"(wire|shaded|colours|lit)"\}@viewport$/,
  /^(other KeyK (mod|ctrl)|mac KeyK mod) \w+ press → ui\.commandPalette@global$/,
  // Layout presets (docs/LAYOUT-PRESETS.md): Alt+0 focus mode, Alt+1…4 the built-in presets, Shift+F full screen
  // and Ctrl+Space as the focus-mode tap (Ctrl is Mod on Windows and Linux).
  /^(other|mac) Digit0 alt \w+ press → workspace\.toggleFocus@global$/,
  /^(other|mac) Digit[1-4] alt \w+ press → workspace\.preset\.apply \{"preset":"(animate|blocking|polish|review)"\}@global$/,
  /^(other|mac) KeyF shift \w+ press → view\.toggleFullscreen@global$/,
  /^(other Space (mod|ctrl)|mac Space ctrl) \w+ tap → workspace\.toggleFocus@global$/,
];

function table(): string[] {
  return [...resolveTable(dccKeymap('other'), 'other'), ...resolveTable(dccKeymap('mac'), 'mac')];
}

describe('Animate keymap (M2a snapshot)', () => {
  it('records a real M2a table', () => {
    expect(M2A.length).toBeGreaterThan(700);
    expect(M2A).toContain('other KeyS - viewport press → key.set {"channels":"all"}@viewport');
    expect(M2A).toContain('mac KeyE mod graph press → ui.open {"dialog":"export"}@global');
  });

  it('keeps every M2a answer in every Animate scope chain', () => {
    const now = new Set(table());
    const lost = M2A.filter((line) => !now.has(line));
    expect(lost).toEqual([]);
  });

  it('adds only the named changes', () => {
    const before = new Set(M2A);
    const added = table().filter((line) => !before.has(line));
    const unexplained = added.filter((line) => !NAMED_CHANGES.some((pattern) => pattern.test(line)));
    expect(unexplained).toEqual([]);
    for (const pattern of NAMED_CHANGES) {
      expect([pattern.source, added.some((line) => pattern.test(line))]).toEqual([pattern.source, true]);
    }
    // Mod+Shift+E and Mod+K over each of the nine chains (Cmd on macOS; Ctrl, probed as mod and as ctrl, elsewhere),
    // R and 4–7 over the viewport.
    // Layout presets: Alt+0…4 and Shift+F over each chain on both platforms, Ctrl+Space taps (probed as mod and as
    // ctrl elsewhere, as ctrl on macOS).
    expect(added).toHaveLength(2 * 9 * 2 + 9 * 2 + 2 * (1 + 4) + 2 * 9 * 6 + 3 * 9);
  });
});
