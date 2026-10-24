// STUDIO-TOUCH-SPEC §20.1, §1.3, §4.8 (T6a): the package's standing rules — every document write is an operator run
// (no store, history or undo writes in the source), Halo never calls `setRigViewOnly` or `providePaneDisplay`; the
// user vocabulary (one word, one kind of thing, ST-32) over the string catalogue; and the visible-target counter.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { DISCLOSURE } from '../src/manifest/disclosure';
import { PLAIN_LABELS } from '../src/manifest/labels';
import { entriesOf, isSurfaceEntry } from '../src/manifest/types';
import { PETAL_VARIANTS, VERB_TABLE } from '../src/verbs/table';
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
    const found = files.flatMap((f) => prefWrites(f.path.slice(SRC.length + 1), f.text));
    expect(found).toEqual([]);
    // every allowed writer still writes (a stale row would hide a moved write)
    for (const [path] of PREF_CONTROLS) {
      const file = files.find((f) => f.path.endsWith(`/${path}`));
      const writes = prefMentions(file?.text ?? '').some((m) => m.kind === 'write');
      expect({ path, found: file !== undefined, writes }).toEqual({ path, found: true, writes: true });
    }
  });
  it('the preference rule: tables name `prefs.set`, sheet controls run it, nothing else writes', () => {
    // positive: a manifest or label table only names the operator; a visible sheet control runs it
    expect(prefWrites('manifest/labels.ts', "export const L = { 'prefs.set': 'Settings' };")).toEqual([]);
    expect(prefWrites('manifest/disclosure.ts', "  'prefs.set': on(2, [S('settings')]),")).toEqual([]);
    expect(prefWrites('sheets/more/MoreSheet.tsx', "void ctx.run('prefs.set', { patch });")).toEqual([]);
    expect(prefWrites('sheets/settings/model.ts', "if (d.writer === 'prefs.set') return d.writer;")).toEqual([]);
    // negative: a direct store write anywhere, the operator run outside a visible control, a write in a table
    expect(prefWrites('sheets/more/MoreSheet.tsx', 'app.prefs.setState({ modeling });')).toEqual([
      'sheets/more/MoreSheet.tsx: prefs.setState (a store write; run prefs.set from a visible control)',
    ]);
    expect(prefWrites('shell/controller.ts', "void ctx.run('prefs.set', { patch: { autoKey: true } });")).toEqual([
      "shell/controller.ts: 'prefs.set' outside a visible control (PREF_CONTROLS)",
    ]);
    expect(prefWrites('manifest/labels.ts', "run('prefs.set', {});")).toEqual([
      "manifest/labels.ts: 'prefs.set' outside a visible control (PREF_CONTROLS)",
    ]);
  });
});

/**
 * The visible controls that may write a shared preference (§16.4), each through the host's `prefs.set` (or the
 * operator that owns the setting): Settings' rows (the descriptor table's writer, run from the row's control) and More's
 * ⚙ Options *Make default*.
 */
const PREF_CONTROLS: ReadonlyMap<string, string> = new Map([
  ['sheets/settings/model.ts', "Settings › every row: the descriptor's writer, run by the row's control"],
  ['sheets/more/MoreSheet.tsx', 'More › ⚙ Options › Make default: the option defaults'],
]);

interface PrefMention {
  readonly kind: 'write' | 'name';
  readonly text: string;
}

/**
 * Every mention of a preference write in a source text: `prefs.setState(` (a direct store write) and the operator id
 * `'prefs.set'` — as a table key (`'prefs.set':`, the manifest and the labels only name it) or as a value (run, or
 * handed to a run).
 */
function prefMentions(text: string): PrefMention[] {
  const out: PrefMention[] = [];
  for (const m of text.matchAll(/prefs\.setState\s*\(/g)) out.push({ kind: 'write', text: m[0] });
  for (const m of text.matchAll(/'prefs\.set'(\s*:)?/g))
    out.push({ kind: m[1] === undefined ? 'write' : 'name', text: m[0] });
  return out;
}

/** The violations of one file (its path relative to `src`). */
function prefWrites(path: string, text: string): string[] {
  const out: string[] = [];
  for (const mention of prefMentions(text)) {
    if (mention.kind === 'name') continue;
    if (mention.text.startsWith('prefs.setState')) {
      out.push(`${path}: prefs.setState (a store write; run prefs.set from a visible control)`);
    } else if (!PREF_CONTROLS.has(path)) {
      out.push(`${path}: 'prefs.set' outside a visible control (PREF_CONTROLS)`);
    }
  }
  return out;
}

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

/**
 * The words a user reads at L0–L2: the shell's catalogue (`i18n/en.ts`), the manifest's plain labels
 * (`manifest/labels.ts`, More and search), its per-argument `plain` words, and the verb table's petals, ▾ choices and
 * in-place variants (`verbs/table.ts`) — one vocabulary (T6-INT: the lint covers T6b's tables too, P-T6B-2).
 */
function vocabulary(): { readonly path: string; readonly text: string }[] {
  const all = strings(en);
  for (const [op, text] of Object.entries(PLAIN_LABELS)) all.push({ path: `labels.${op}`, text });
  for (const [op, value] of Object.entries(DISCLOSURE)) {
    for (const entry of entriesOf(value)) {
      if (isSurfaceEntry(entry) && entry.plain !== undefined) all.push({ path: `plain.${op}`, text: entry.plain });
    }
  }
  for (const [noun, petals] of Object.entries(VERB_TABLE)) {
    for (const petal of petals) {
      all.push({ path: `table.${noun}.${petal.id}`, text: petal.plain });
      for (const choice of petal.menu ?? []) all.push({ path: `table.${noun}.${petal.id}.menu`, text: choice.plain });
    }
  }
  for (const [noun, variants] of Object.entries(PETAL_VARIANTS)) {
    for (const variant of variants ?? []) all.push({ path: `table.${noun}.${variant.id}`, text: variant.plain });
  }
  return all;
}

describe('user vocabulary: one word, one kind of thing (§1.3, ST-32)', () => {
  const all = vocabulary();
  const where = (word: RegExp): string[] => all.filter((s) => word.test(s.text)).map((s) => s.path);

  it('covers the catalogue, the manifest labels and the verb table', () => {
    expect(all.some((s) => s.path.startsWith('labels.'))).toBe(true);
    expect(all.some((s) => s.path.startsWith('plain.'))).toBe(true);
    expect(all.some((s) => s.path.startsWith('table.'))).toBe(true);
  });

  it('“Move” is never a clip; “Animation” is only a clip', () => {
    expect(all.filter((s) => /\bmoves?\b/i.test(s.text) && /animation|clip/i.test(s.text))).toEqual([]);
    // every use names clips: a new one, one from a file or the library, a game slot's, the clips a pose change keeps,
    // the Animations panel, the product line
    for (const path of where(/\banimations?\b/i)) {
      expect(path).toMatch(
        /^(home\.|dialogs\.applyPoseAsRest|labels\.(clip\.|file\.importAnimation|autorig\.clip\.|target\.slot\.)|plain\.(target\.slot\.|workspace\.showPanel)|table\.empty\.newAnimation)/,
      );
    }
  });

  it('“Numbers” is only the Inspector; “Other side” only the mirrored part; “New shape” only a primitive', () => {
    // the Inspector itself, and Pro's Channels and Attributes panels, which arrive at it (ST-T6B-7)
    expect(where(/\bNumbers\b/)).toEqual(['halo.numbers', 'sheets.numbers', 'plain.workspace.showPanel']);
    expect(where(/\bOther side\b/i)).toEqual([
      'halo.otherSide',
      'labels.select.mirror',
      'plain.select.mirror',
      'table.rigDot.mirror',
    ]);
    expect(where(/\bnew shape\b/i)).toEqual(['table.empty.newShape']);
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
