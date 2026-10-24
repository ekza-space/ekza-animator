// STUDIO-TOUCH-SPEC §20.1, §1.3, §4.8 (T6a): the package's standing rules — every document write is an operator run
// (no store, history or undo writes in the source), Halo never calls `setRigViewOnly` or `providePaneDisplay`; the
// user vocabulary (one word, one kind of thing, ST-32) over the string catalogue; and the visible-target counter.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { TARGET_BUDGET, visibleTarget } from '../src/shell/targets';

const SRC = new URL('../src', import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('every document write is an operator run (§20.1)', () => {
  const files = sources(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  it('no store, history or undo-manager writes', () => {
    const write =
      /\.store\.(transact|transaction|applyChanges|beginPreview|load|put|patch|remove|undoManager)\b|\.history\.(undo|redo|record|recordSelection|clear|dropOldest)\(/;
    expect(files.filter((f) => write.test(f.text)).map((f) => f.path)).toEqual([]);
  });
  it('never the view-only rule or the pane display memory', () => {
    expect(files.filter((f) => /setRigViewOnly|providePaneDisplay/.test(f.text)).map((f) => f.path)).toEqual([]);
  });
  it('no shared preference written implicitly (only a visible control may, §16.4)', () => {
    expect(files.filter((f) => /prefs\.setState|'prefs\.set'/.test(f.text)).map((f) => f.path)).toEqual([]);
  });
});

/** Every string of the catalogue with its key path (functions called with a sample value). */
function strings(node: unknown, path: string[] = []): { readonly path: string; readonly text: string }[] {
  if (typeof node === 'string') return [{ path: path.join('.'), text: node }];
  if (typeof node === 'function') return [{ path: path.join('.'), text: String((node as (v: unknown) => unknown)(2)) }];
  if (Array.isArray(node)) return node.flatMap((v, i) => strings(v, [...path, String(i)]));
  if (typeof node === 'object' && node !== null) {
    return Object.entries(node).flatMap(([k, v]) => strings(v, [...path, k]));
  }
  return [];
}

describe('user vocabulary: one word, one kind of thing (§1.3, ST-32)', () => {
  const all = strings(en);
  const where = (word: RegExp): string[] => all.filter((s) => word.test(s.text)).map((s) => s.path);

  it('“Move” is never a clip; “Animation” is only a clip', () => {
    expect(all.filter((s) => /\bmoves?\b/i.test(s.text) && /animation|clip/i.test(s.text))).toEqual([]);
    // every use names clips: a new one, the clips a pose change keeps, the product line
    for (const path of where(/\banimations?\b/i)) {
      expect(path).toMatch(/^(verbs\.newAnimation|home\.|dialogs\.applyPoseAsRest)/);
    }
  });

  it('“Numbers” is only the Inspector; “Other side” only the mirrored part; “New shape” only a primitive', () => {
    expect(where(/\bNumbers\b/)).toEqual(['halo.numbers', 'sheets.numbers']);
    expect(where(/\bOther side\b/i)).toEqual(['halo.otherSide']);
    expect(where(/\bnew shape\b/i)).toEqual(['verbs.newShape']);
  });

  it('the selection meanings are the Thumb key’s, and never start with “Add”', () => {
    for (const path of where(/\bselect more\b|\bpick or unpick\b|\bunselect\b/i)) expect(path).toMatch(/^thumb\./);
    expect(all.filter((s) => s.path.startsWith('thumb.') && /^add\b/i.test(s.text))).toEqual([]);
  });

  it('“Export” and “Save project” never stand for each other', () => {
    expect(all.filter((s) => /save project/i.test(s.text) && /export/i.test(s.text))).toEqual([]);
  });

  it('no DCC jargon at L0 or L1 (Pro names appear one layer down, from the registry)', () => {
    const jargon =
      /\b(extrude|tween|breakdown|ripple|euler|tangents?|IK|FK|influences?|bind pose|lambert|blinn|tris)\b/i;
    expect(all.filter((s) => jargon.test(s.text)).map((s) => `${s.path}: ${s.text}`)).toEqual([]);
  });
});

describe('the visible-target counter (§4.8, ST-37)', () => {
  const style = () => ({ visibility: 'visible', opacity: '1', display: 'block' });
  const el = (rect: { left: number; top: number; width: number; height: number }, closest: Element | null = null) => ({
    closest: () => closest,
    parentElement: null,
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
  });
  const viewport = { width: 1194, height: 834 };
  it('counts what is on screen, sized and not inert, hidden or faded', () => {
    expect(visibleTarget(el({ left: 10, top: 10, width: 44, height: 44 }), style, viewport)).toBe(true);
    expect(visibleTarget(el({ left: 10, top: 10, width: 0, height: 44 }), style, viewport)).toBe(false);
    expect(visibleTarget(el({ left: 1300, top: 10, width: 44, height: 44 }), style, viewport)).toBe(false);
    expect(visibleTarget(el({ left: 10, top: 10, width: 44, height: 44 }, {} as Element), style, viewport)).toBe(false);
    const faded = () => ({ visibility: 'visible', opacity: '0.01', display: 'block' });
    expect(visibleTarget(el({ left: 10, top: 10, width: 44, height: 44 }), faded, viewport)).toBe(false);
  });
  it('holds the budgets of §4.8', () => {
    expect(TARGET_BUDGET).toEqual({ rest: 22, halo: 36 });
  });
});
