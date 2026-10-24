// T4 exit checks that live in the ui package (STUDIO-TOUCH-SPEC §21 T4, §20.6): the 44 px / 16 px tokens and the
// touch scope in styles.css, the TS constants in step with tokens.json, and the kit kept off Studio Pro's routes —
// its own `./touch` subpath, never reachable from the package root, importing nothing Pro's eager code would share
// beyond React, the Dialog primitive and `cn`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOUCH } from '../../src/touch';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string): string => readFileSync(join(UI, path), 'utf8');
const tokens = JSON.parse(read('tokens.json')) as {
  readonly size: Record<string, string>;
  readonly space: Record<string, string>;
  readonly type: Record<string, { readonly size: string }>;
};
const px = (v: string | undefined): number => Number(/^(\d+(?:\.\d+)?)px$/.exec(v ?? '')?.[1] ?? Number.NaN);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

const specifiers = (source: string): string[] =>
  [...source.matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*?from\s+'([^']+)'/g)].map((m) => m[1] ?? '');

describe('touch tokens (44 pt / 16 px)', () => {
  it('tokens.json carries the touch sizes and the TS constants match', () => {
    expect(px(tokens.size['size-touch-hit'])).toBe(44);
    expect(px(tokens.size['size-touch-key'])).toBe(56);
    expect(px(tokens.size['size-touch-bar'])).toBe(52);
    expect(px(tokens.size['size-touch-sheet'])).toBe(360);
    expect(px(tokens.space['space-gutter'])).toBe(16);
    expect(px(tokens.space['space-edge-side'])).toBe(12);
    expect(px(tokens.space['space-edge-bottom'])).toBe(20);
    expect(px(tokens.type['touch-input']?.size)).toBe(16);
    expect([TOUCH.hit, TOUCH.thumbKey, TOUCH.topBar, TOUCH.sheetWidth, TOUCH.gutter, TOUCH.edgeSide]).toEqual([
      44, 56, 52, 360, 16, 12,
    ]);
    expect([TOUCH.edgeBottom, TOUCH.inputText]).toEqual([20, 16]);
  });

  it('the touch scope gives Studio’s shared sizes 44 px hits and 16 px+ inputs, scaled up, never down', () => {
    const styles = read('styles.css');
    const scope = /\n\[data-density="touch"\] \{([\s\S]*?)\n\}/.exec(styles)?.[1] ?? '';
    expect(scope).toContain('--touch-hit: max(var(--size-touch-hit), calc(var(--size-touch-hit) * var(--ui-scale)));');
    expect(scope).toContain(
      '--touch-input-text: max(var(--type-touch-input-size), calc(var(--type-touch-input-size) * var(--ui-scale)));',
    );
    for (const name of ['--size-row', '--size-hit', '--size-field', '--size-field-dialog']) {
      expect(scope).toContain(`${name}: var(--touch-hit);`);
    }
    expect(scope).toContain('--touch-inset-left: max(var(--space-gutter), env(safe-area-inset-left, 0px));');
    expect(scope).toContain('--touch-inset-bottom: max(var(--space-edge-bottom), env(safe-area-inset-bottom, 0px));');
    expect(styles).toMatch(
      /\[data-density="touch"\] :is\(input, textarea, select\) \{\s*font-size: var\(--touch-input-text\);/,
    );
    expect(styles).toMatch(/\[data-density="touch"\] :focus-visible[\s\S]*?outline: 2px solid var\(--accent-text\);/);
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-density="touch"\] \*,[\s\S]*?transition-duration: 0ms !important;/,
    );
  });

  it('the shell policy class turns off page pan, zoom, overscroll, selection and the callout (§4.1)', () => {
    const styles = read('styles.css');
    const policy = /html\.ekza-touch-policy,\s*html\.ekza-touch-policy body \{([\s\S]*?)\}/.exec(styles)?.[1] ?? '';
    for (const rule of [
      'touch-action: none;',
      'overscroll-behavior: none;',
      'user-select: none;',
      '-webkit-touch-callout: none;',
    ]) {
      expect(policy).toContain(rule);
    }
    expect(styles).toMatch(
      /html\.ekza-touch-policy \[data-touch-scroll\] \{\s*touch-action: pan-y;\s*overscroll-behavior: contain;/,
    );
  });
});

describe('the kit stays off Studio Pro’s routes (/editor +0 B)', () => {
  const src = join(UI, 'src');
  const touchDir = join(src, 'touch');

  it('is its own package subpath', () => {
    const pkg = JSON.parse(read('package.json')) as { exports: Record<string, string>; sideEffects: string[] };
    expect(pkg.exports['./touch']).toBe('./src/touch/index.ts');
    expect(pkg.sideEffects).toEqual(['**/*.css']);
  });

  it('nothing outside src/touch imports it (the root barrel included)', () => {
    for (const file of files(src).filter((f) => !f.startsWith(touchDir))) {
      const touching = specifiers(readFileSync(file, 'utf8')).filter((spec) => /(^|\/)touch(\/|$)/.test(spec));
      expect({ file: relative(UI, file), touching }).toEqual({ file: relative(UI, file), touching: [] });
    }
  });

  it('imports only React, the Radix Dialog, `cn` and its own modules', () => {
    for (const file of files(touchDir)) {
      const source = readFileSync(file, 'utf8');
      for (const spec of specifiers(source)) {
        const ok = spec === 'react' || spec === 'radix-ui' || spec === '../cn' || /^\.\/[\w-]+$/.test(spec);
        expect({ file: relative(UI, file), spec, ok }).toEqual({ file: relative(UI, file), spec, ok: true });
      }
      const radix = [...source.matchAll(/import \{([^}]*)\} from 'radix-ui';/g)].map((m) => m[1]?.trim());
      expect(radix.filter((names) => names !== 'Dialog as DialogPrimitive')).toEqual([]);
    }
  });
});
