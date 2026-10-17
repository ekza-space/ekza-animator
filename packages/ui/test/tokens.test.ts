import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DOCKVIEW_CORE_CSS,
  generate,
  renderTokensCss,
  stripDockviewThemes,
  TOKENS_CSS,
  TOKENS_JSON,
} from '../scripts/build-tokens.mjs';

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

interface Tokens {
  readonly color: Readonly<Record<string, string>>;
  readonly contrast: readonly { readonly fg: string; readonly bg: readonly string[]; readonly min: number }[];
  readonly [group: string]: unknown;
}

const tokens = JSON.parse(readFileSync(TOKENS_JSON, 'utf8')) as Tokens;

/** WCAG 2.x relative luminance of an opaque `#rrggbb` colour. */
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) throw new Error(`not an opaque #rrggbb colour: ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => {
    const c = Number.parseInt(part ?? '0', 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('design tokens', () => {
  it('generated CSS files are up to date (run scripts/build-tokens.mjs)', () => {
    for (const [path, content] of generate()) {
      expect({ path, content: readFileSync(path, 'utf8') }).toEqual({ path, content });
    }
  });

  it('writes every colour token as a custom property', () => {
    const css = renderTokensCss(tokens);
    for (const [name, value] of Object.entries(tokens.color)) expect(css).toContain(`--${name}: ${value};`);
    expect(css).toContain('--sel: #ffffff;');
    expect(css).toContain('--sel-lead: #7dff8a;');
    expect(css).toContain('--sel-hover: #ffe58a;');
    expect(css).toContain('--range-select: rgba(229, 72, 77, 0.22);');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*--motion-hover: 0ms;/);
  });

  it.each(tokens.contrast.flatMap((rule) => rule.bg.map((bg) => [rule.fg, bg, rule.min] as const)))(
    'contrast of %s on %s is at least %s:1 (research 09 §8.3)',
    (fg, bg, min) => {
      const fgValue = tokens.color[fg];
      const bgValue = tokens.color[bg];
      expect(fgValue).toBeDefined();
      expect(bgValue).toBeDefined();
      expect(contrast(fgValue ?? '', bgValue ?? '')).toBeGreaterThanOrEqual(min);
    },
  );

  it('matches the published contrast table where research 09 §8.3 gives a value', () => {
    const c = (fg: string, bg: string): number => contrast(tokens.color[fg] ?? '', tokens.color[bg] ?? '');
    expect(c('text', 'bg-app')).toBeCloseTo(13.78, 1);
    expect(c('text-3', 'bg-hover')).toBeCloseTo(4.59, 1);
    expect(c('on-accent', 'accent-fill')).toBeCloseTo(5.23, 1);
    expect(c('key-tick', 'bg-header')).toBeCloseTo(3.61, 1);
  });
});

describe('stylesheets', () => {
  const styles = readFileSync(join(UI_DIR, 'styles.css'), 'utf8');
  const theme = readFileSync(join(UI_DIR, 'css', 'dockview-theme.css'), 'utf8');
  const tokensCss = readFileSync(TOKENS_CSS, 'utf8');
  const dockview = readFileSync(DOCKVIEW_CORE_CSS, 'utf8');

  it('styles.css starts with the Tailwind import and the workspace @source lines (MVP-SPEC §3 convention 11)', () => {
    expect(styles.split('\n').slice(0, 3)).toEqual([
      '@import "tailwindcss";',
      '@source "../editor/src";',
      '@source "./src";',
    ]);
  });

  it('references only custom properties that the tokens, dockview, Radix or Tailwind define', () => {
    const defined = new Set([...tokensCss.matchAll(/--([\w-]+):/g)].map((m) => m[1]));
    for (const m of styles.matchAll(/--([\w-]+):/g)) defined.add(m[1]);
    const used = [...`${styles}\n${theme}`.matchAll(/var\(--([\w-]+)/g)].map((m) => m[1] ?? '');
    const unknown = used.filter((name) => !defined.has(name) && !/^(dv|radix|tw)-/.test(name));
    expect(unknown).toEqual([]);
  });

  it('keeps dockview structural rules and drops its colour themes', () => {
    expect(dockview).toContain('.dv-split-view-container');
    expect(dockview).toContain('SPDX-License-Identifier: MIT');
    expect(dockview).not.toMatch(/\.dockview-theme-/);
    expect(
      stripDockviewThemes('.a{color:red}\n.dockview-theme-dark .a{color:blue}\n@media (x){.dockview-theme-x{a:b}}'),
    ).toBe('.a {color:red}');
    expect(stripDockviewThemes('@media (x){.a{a:b}.dockview-theme-x{a:b}}')).toBe('@media (x) {\n  .a {a:b}\n}');
  });
});
