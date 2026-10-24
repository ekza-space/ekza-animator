// The Disclosure Manifest's lints (STUDIO-TOUCH-SPEC §20.5, AS-ST-2, AS-ST-20; T6b) on a headless registry with every
// lazy operator chunk. The full check — every mount joined, the call-site scan, the ratchet — is the browser spec
// `apps/web/e2e/ha-parity.spec.ts`; these tests keep the manifest's own shape honest without a browser: every operator
// a headless app registers has an entry, the entries resolve (petals in the verb table, sheet sections, proOnly and
// plumbing lists), the per-argument predicates are disjoint, every `UiDialog` has a surface, and the parameter surfaces
// sit on operators the manifest shows.
import {
  createHeadlessEditorApp,
  type EditorApp,
  loadModelOperators,
  loadUiWrappers,
  type UiDialog,
} from '@ekza-studio/editor-core';
import type { ParamDef } from '@ekza-studio/anim-core';
import { formOf } from '@ekza-studio/editor-core/forms';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { type Census, type CensusOperator, liveCensus } from '../../src/manifest/census';
import { checkParity, disjoint, entryFor, matchArgs } from '../../src/manifest/check';
import { DEFERRED_DIALOGS, DIALOG_SURFACES } from '../../src/manifest/dialogs';
import { DISCLOSURE } from '../../src/manifest/disclosure';
import { PARAM_SURFACES } from '../../src/manifest/paramSurfaces';
import { PLUMBING_ALLOWLIST } from '../../src/manifest/plumbing';
import { entriesOf, isSurfaceEntry, NOUN_KINDS, STAGES } from '../../src/manifest/types';
import { MAX_PETALS, petalsFor, VERB_TABLE } from '../../src/verbs/table';

// Headless apps with every chunk load slowly on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

let app: EditorApp;
let headless: Census;

beforeAll(async () => {
  app = createHeadlessEditorApp();
  await Promise.all([app.rig.load(), app.library.load(), loadModelOperators(), loadUiWrappers(app)]);
  headless = liveCensus(app, 'headless');
}, 60_000);

/** The headless census plus the manifest's UI-only ids (registered only while a UI is mounted; the browser spec
 *  checks those for real), so the structural lints can run on the whole manifest. */
function withUiOperators(census: Census): Census {
  const known = new Set(census.operators.map((op) => op.id));
  const extra: CensusOperator[] = Object.keys(DISCLOSURE)
    .filter((id) => !known.has(id))
    .map((id) => {
      const entries = entriesOf(DISCLOSURE[id] ?? []);
      const internal = entries.some((entry) => 'plumbing' in entry || 'wraps' in entry);
      return {
        id,
        label: id,
        category: id.slice(0, id.indexOf('.')),
        internal,
        deferred: false,
        undo: false,
        adjustable: false,
        repeatable: false,
        selection: false,
        tool: null,
        workspaces: null,
        params: [],
      };
    });
  return { ...census, operators: [...census.operators, ...extra] };
}

describe('Disclosure Manifest (§20.5)', () => {
  it('has an entry for every live operator of a headless app, and none for a deferred stub', () => {
    const live = headless.operators.filter((op) => !op.deferred).map((op) => op.id);
    expect(live.length).toBeGreaterThan(300);
    expect(live.filter((id) => DISCLOSURE[id] === undefined)).toEqual([]);
    const deferred = headless.operators.filter((op) => op.deferred).map((op) => op.id);
    expect(deferred.length).toBeGreaterThan(40);
    expect(deferred.filter((id) => DISCLOSURE[id] !== undefined)).toEqual([]);
  });

  it('passes the structural parity checks (tests 1, 5–8) with no violation', () => {
    const report = checkParity({ census: withUiOperators(headless) });
    expect(report.violations).toEqual([]);
  });

  it('checks the menu, marking-menu and key-binding arguments of a headless app (tests 2–4)', () => {
    const report = checkParity({ census: withUiOperators(headless) });
    expect(report.pairs.checked).toBeGreaterThan(200);
  });

  it('gives a plumbing entry only to allow-listed operators, and every allow-listed one that exists has it', () => {
    const plumbing = Object.entries(DISCLOSURE)
      .filter(([, value]) => entriesOf(value).some((entry) => 'plumbing' in entry))
      .map(([id]) => id);
    expect(plumbing.length).toBeGreaterThan(3);
    expect(plumbing.filter((id) => PLUMBING_ALLOWLIST[id] === undefined)).toEqual([]);
  });

  it('reports a missing entry, an unknown predicate value and an unresolved petal', () => {
    const census = withUiOperators(headless);
    const { 'mesh.extrude': _dropped, ...rest } = DISCLOSURE;
    expect(checkParity({ census, manifest: rest }).violations).toContain(
      'mesh.extrude: live operator without a manifest entry',
    );
    const pairs = [{ op: 'time.setSpeed', args: { speed: 'quadruple' }, sites: ['x.ts:1'] }];
    expect(checkParity({ census, callSites: pairs }).violations).toEqual([
      'time.setSpeed {"speed":"quadruple"} (scan:x.ts:1): no entry covers these arguments',
    ]);
    const bad = { ...DISCLOSURE, 'mesh.inset': { surfaces: [{ petal: 'joint' as const }], depth: 1 as const } };
    expect(checkParity({ census, manifest: bad }).violations).toContain(
      "mesh.inset: petal on 'joint' is not in the verb table (verbs/table.ts)",
    );
  });
});

describe('argument predicates', () => {
  it('match literals, dotted paths, missing keys and scan wildcards', () => {
    expect(matchArgs({ dialog: 'export' }, { dialog: ['export', 'open'] })).toBe('yes');
    expect(matchArgs({ dialog: 'about' }, { dialog: 'export' })).toBe('no');
    expect(matchArgs({ patch: { jointAxes: 'all' } }, { 'patch.jointAxes': ['all', 'none'] })).toBe('yes');
    expect(matchArgs(null, { panel: null })).toBe('yes');
    expect(matchArgs({ paneId: 'p' }, { panel: null })).toBe('yes');
    expect(matchArgs({ dialog: '*' }, { dialog: 'export' })).toBe('dynamic');
    expect(matchArgs('*', { dialog: 'export' })).toBe('dynamic');
    expect(matchArgs({ '...': '*' }, { panel: 'graph' })).toBe('dynamic');
    expect(matchArgs({ anything: 1 }, undefined)).toBe('yes');
  });

  it('pick the matching entry, else the one without a predicate', () => {
    const entries = [
      { searchOnly: 'a', when: { to: 'studio' } },
      { searchOnly: 'b', when: { to: 'autorig' } },
      { searchOnly: 'c' },
    ];
    expect(entryFor(entries, { to: 'autorig' })?.entry).toBe(entries[1]);
    expect(entryFor(entries, { to: 'halo' })?.entry).toBe(entries[2]);
    expect(entryFor(entries.slice(0, 2), { to: 'halo' })).toBeNull();
  });

  it('are disjoint when a shared key allows no common value', () => {
    expect(disjoint({ to: 'studio' }, { to: ['autorig', 'halo'] })).toBe(true);
    expect(disjoint({ to: 'studio' }, { to: ['studio', 'halo'] })).toBe(false);
    expect(disjoint({ to: 'studio' }, { panel: 'graph' })).toBe(false);
  });
});

describe('kernel questions (§6.7, AS-ST-20)', () => {
  it('map every UiDialog value to a Halo surface or list it as deferred', () => {
    // The Record<UiDialog, …> type makes a new value fail the typecheck; this pins the current list.
    const all: UiDialog[] = [
      'open',
      'import',
      'export',
      'shortcuts',
      'about',
      'firstRun',
      'preferences',
      'recovery',
      'makeEditableReport',
      'imagePlaneImport',
      'layoutPresets',
      'applyPoseAsRest',
      'unbindSkin',
      'rebindSkin',
      'vrmMeta',
      'makeCharacterEditable',
      'attachProp',
    ];
    expect(Object.keys(DIALOG_SURFACES).sort()).toEqual([...all].sort());
    expect([...DEFERRED_DIALOGS].sort()).toEqual(['attachProp', 'makeCharacterEditable']);
    expect(DIALOG_SURFACES.rebindSkin).toMatchObject({ confirm: 'skin.bind' });
    expect(DIALOG_SURFACES.unbindSkin).toMatchObject({ confirm: 'skin.unbind' });
    expect(DIALOG_SURFACES.applyPoseAsRest).toMatchObject({ confirm: 'skel.pose.applyAsRest' });
    expect(DIALOG_SURFACES.vrmMeta).toEqual({ sheet: 'about' });
    expect(DIALOG_SURFACES.preferences).toEqual({ sheet: 'settings' });
  });

  it('derive one ui.open entry per Halo surface, covering every non-deferred dialog', () => {
    const entries = entriesOf(DISCLOSURE['ui.open'] ?? []);
    const dialogs = Object.keys(DIALOG_SURFACES) as UiDialog[];
    const matches = Object.fromEntries(dialogs.map((dialog) => [dialog, entryFor(entries, { dialog })?.match ?? null]));
    const expected = Object.fromEntries(
      dialogs.map((dialog) => [dialog, DEFERRED_DIALOGS.includes(dialog) ? null : 'yes']),
    );
    expect(matches).toEqual(expected);
  });
});

describe('verb table (§6.1, §6.2)', () => {
  it('has at most six petals per noun and stage, every petal op shown on that noun by the manifest', () => {
    for (const noun of NOUN_KINDS) {
      for (const stage of STAGES) expect(petalsFor(noun, stage).length).toBeLessThanOrEqual(MAX_PETALS);
      for (const petal of VERB_TABLE[noun]) {
        if (petal.op === undefined) continue;
        const entries = entriesOf(DISCLOSURE[petal.op] ?? []);
        const shown = entries.some(
          (entry) => isSurfaceEntry(entry) && entry.surfaces.some((s) => 'petal' in s && s.petal === noun),
        );
        expect({ noun, op: petal.op, shown }).toEqual({ noun, op: petal.op, shown: true });
      }
    }
  });
});

describe('parameter surfaces (§20.5 test 9)', () => {
  // T6-INT (P-T6A-3): PARAM_SURFACES is fed from what the shell shows — the Echo chips after every adjustable run with
  // visible ParamDefs (`echoParams`), and the pre-run form the runner and More open whenever `formOf` answers.
  const visible = (params: readonly ParamDef[] | undefined): readonly ParamDef[] =>
    (params ?? []).filter((p) => p.hidden !== true && p.kind !== 'data' && p.bound !== 'pointer');
  const ranFromHalo = (op: string): boolean =>
    entriesOf(DISCLOSURE[op] ?? []).some(
      (entry) => isSurfaceEntry(entry) && entry.surfaces.some((s) => 'petal' in s || 'more' in s),
    );
  const surfaced = (op: string): boolean => entriesOf(DISCLOSURE[op] ?? []).some((entry) => isSurfaceEntry(entry));

  it('lists the chips of every adjustable operator the shell runs, and only those', () => {
    const chips = app.operators
      .list()
      .filter((def) => def.flags?.adjustable === true && visible(def.params).length > 0 && surfaced(def.id))
      .map((def): string => def.id);
    const listed = PARAM_SURFACES.filter((s) => s.surface === 'chips').map((s) => s.op);
    expect(chips.filter((op) => !listed.includes(op))).toEqual([]);
    expect(listed.filter((op) => !chips.includes(op))).toEqual([]);
  });

  it('lists the form of every operator a petal or a More row opens one for, and only operators with a form', () => {
    const forms = app.operators
      .list()
      .filter((def) => formOf(def.id, def as never) !== null)
      .map((def): string => def.id);
    const listed = PARAM_SURFACES.filter((s) => s.surface === 'form').map((s) => s.op);
    expect(forms.filter((op) => ranFromHalo(op) && !listed.includes(op))).toEqual([]);
    expect(listed.filter((op) => !forms.includes(op))).toEqual([]);
  });

  it('sit on operators the manifest shows on a surface', () => {
    const missing = PARAM_SURFACES.filter(
      ({ op }) => !entriesOf(DISCLOSURE[op] ?? []).some((entry) => isSurfaceEntry(entry) || 'wraps' in entry),
    );
    expect(missing).toEqual([]);
  });
});
