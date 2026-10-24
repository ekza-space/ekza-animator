// The Settings sheet's model (STUDIO-TOUCH-SPEC §15.14, §16.4; T6b) over a headless app: Settings is generated from
// the preferences descriptor table (every control once, hidden ones never), each control writes through an operator
// call that reads back, the shared Studio Pro preferences say so, a session override shows with a note, and every
// operator the Disclosure Manifest places in Settings has a control or section here.
import {
  createHeadlessEditorApp,
  type EditorApp,
  type OperatorDef,
  overridePrefs,
  PREF_DESCRIPTORS,
  PREF_SECTIONS,
  type Prefs,
  prefValue,
} from '@ekza-studio/editor-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { DIALOG_SURFACES } from '../../src/manifest/dialogs';
import { DISCLOSURE } from '../../src/manifest/disclosure';
import { SHEET_SECTIONS } from '../../src/manifest/sheets';
import { entriesOf, isSurfaceEntry, type SurfaceRef } from '../../src/manifest/types';
import { type SettingsControl, settingsControls, settingsSections } from '../../src/sheets/settings/model';

/**
 * The page host registers `prefs.set` (`@ekza-studio/editor/host` `registerHostOperators`, not exported); a headless
 * app has none, so the test registers the same operator: the host's allow-list check is left out, `apply` is the same.
 */
function registerPrefsSet(app: EditorApp): void {
  const def: OperatorDef<{ readonly patch: Partial<Omit<Prefs, 'version'>> }> = {
    id: 'prefs.set',
    label: 'Set Preferences',
    category: 'ui',
    scope: 'global',
    flags: { internal: true },
    apply(_ctx, args) {
      app.prefs.setState({ ...args.patch });
    },
  };
  app.contribute({ kind: 'operator', def });
}

let app: EditorApp;

beforeEach(() => {
  app = createHeadlessEditorApp();
  registerPrefsSet(app);
});

function control(path: string): SettingsControl {
  const found = settingsControls(app).find((entry) => entry.control.path === path);
  if (found === undefined) throw new Error(`no control for ${path}`);
  return found.control;
}

/** Runs a control's write; returns `<op>: <status>` (or why nothing ran) for one `toBe` per call. */
async function write(target: SettingsControl, value: boolean | string | number): Promise<string> {
  const call = target.write(value);
  if (call === null) return `${target.key}: no write`;
  const result = await app.runUntyped(call.op, call.args);
  return `${call.op}: ${result.status}`;
}

describe('Settings is generated from the descriptor table (§15.14 row 14.7)', () => {
  it('has every section of SHEET_SECTIONS.settings, in order, and each descriptor section its page and label', () => {
    const sections = settingsSections(app);
    expect(sections.map((section) => section.id)).toEqual(SHEET_SECTIONS.settings);
    const shown = PREF_SECTIONS.filter((def) => def.page !== 'none').map((def) => [def.id, def.page, def.label]);
    const model = shown.map(([id]) => {
      const section = sections.find((s) => s.id === id);
      return [id, section?.page, section?.label];
    });
    expect(model).toEqual(shown);
    expect(sections.filter((s) => PREF_SECTIONS.some((def) => def.id === s.id && def.page === 'none'))).toEqual([]);
  });

  it('shows every descriptor that is not hidden exactly once, under its own section, with its words', () => {
    const controls = settingsControls(app);
    const visible = PREF_DESCRIPTORS.filter((d) => d.hidden === undefined);
    const expected = visible.map((d) => [d.path, d.section, d.label, d.proName ?? null, d.help ?? null]);
    const found = visible.map((d) => {
      const hits = controls.filter((entry) => entry.control.path === d.path);
      const hit = hits[0];
      return hits.length === 1 && hit !== undefined
        ? [d.path, hit.section, hit.control.label, hit.control.proName, hit.control.help]
        : [d.path, `${hits.length} controls`];
    });
    expect(found).toEqual(expected);
  });

  it('never shows a hidden descriptor', () => {
    const paths = new Set(settingsControls(app).map((entry) => entry.control.path));
    const hidden = PREF_DESCRIPTORS.filter((d) => d.hidden !== undefined).map((d) => d.path);
    expect(hidden.length).toBeGreaterThan(5);
    expect(hidden.filter((path) => paths.has(path))).toEqual([]);
  });

  it('draws each kind with its control: toggles, segments or a list, numbers with their unit and range', () => {
    const wrong = settingsControls(app)
      .map(({ control: c }) => c)
      .filter((c) => c.disabledReason === null)
      .filter((c) => {
        if (c.kind === 'boolean') return c.presentation !== 'toggle';
        if (c.kind === 'enum') return c.options.length > 4 ? c.presentation !== 'list' : c.presentation === 'number';
        if (c.kind === 'number') return c.presentation !== 'number' || c.unit === null || c.range === null;
        return true;
      })
      .map((c) => c.key);
    expect(wrong).toEqual([]);
    const scale = control('uiScale');
    expect([scale.label, scale.unit, scale.range, scale.value]).toEqual([
      'Text & touch size',
      '%',
      { min: 85, max: 150, step: 5 },
      100,
    ]);
  });
});

describe('a control writes through an operator and reads back (§16.4: only its own control changes it)', () => {
  it('a boolean (Blend can go past its keys)', async () => {
    const target = control('tweenOvershoot');
    const next = target.value !== true;
    expect(target.op).toBe('prefs.set');
    expect(await write(target, next)).toBe('prefs.set: finished');
    expect(prefValue(app.prefs.getState(), 'tweenOvershoot')).toBe(next);
    expect(control('tweenOvershoot').value).toBe(next);
  });

  it('an enum (Handles on curves) and a nested one (New keys ease in)', async () => {
    expect(await write(control('graphHandles'), 'all')).toBe('prefs.set: finished');
    expect(app.prefs.getState().graphHandles).toBe('all');
    const before = app.prefs.getState().defaultTangents.out;
    expect(await write(control('defaultTangents.in'), 'linear')).toBe('prefs.set: finished');
    expect(app.prefs.getState().defaultTangents).toEqual({ in: 'linear', out: before });
    expect(control('defaultTangents.in').presentation).toBe('list');
    expect(control('defaultTangents.in').write('nonsense')).toBeNull();
  });

  it('a number shown in another unit (Snap step for Turn: degrees shown, radians stored)', async () => {
    const gridStep = app.prefs.getState().modeling.gridStep;
    expect(await write(control('modeling.increments.rotate'), 15)).toBe('prefs.set: finished');
    expect(prefValue(app.prefs.getState(), 'modeling.increments.rotate')).toBeCloseTo(Math.PI / 12, 12);
    expect(control('modeling.increments.rotate').value).toBe(15);
    // The rest of `modeling` is untouched (prefs.set merges top-level keys only, the patch carries a copy).
    expect(app.prefs.getState().modeling.gridStep).toBe(gridStep);
  });

  it('Text & touch size writes uiScale as a factor, clamped to 85–150 %', async () => {
    expect(await write(control('uiScale'), 120)).toBe('prefs.set: finished');
    expect(app.prefs.getState().uiScale).toBeCloseTo(1.2, 12);
    expect(control('uiScale').value).toBe(120);
    expect(await write(control('uiScale'), 400)).toBe('prefs.set: finished');
    expect(app.prefs.getState().uiScale).toBeCloseTo(1.5, 12);
    // A size Studio Pro stored outside the range shows clamped (both shells read it so, §18).
    app.prefs.setState({ uiScale: 0.5 });
    expect(control('uiScale').value).toBe(85);
  });

  it('Mouse and trackpad writes through view.setNavProfile (Settings › Input in the manifest)', async () => {
    const nav = control('navProfile');
    expect(nav.op).toBe('view.setNavProfile');
    expect(nav.write('trackpad')).toEqual({ op: 'view.setNavProfile', args: { profile: 'trackpad' } });
    expect(await write(nav, 'trackpad')).toBe('view.setNavProfile: finished');
    expect(app.prefs.getState().navProfile).toBe('trackpad');
  });

  it('Auto Key in Studio Pro writes through key.toggleAutoKey, and only on a real change', async () => {
    const section = settingsSections(app).find((s) => s.id === 'animation');
    const autoKey = section?.controls.find((c) => c.op === 'key.toggleAutoKey');
    expect([autoKey?.label, autoKey?.path, autoKey?.shared]).toEqual(['Auto Key in Studio Pro', null, true]);
    const was = app.prefs.getState().autoKey;
    expect(autoKey?.write(was)).toBeNull();
    expect(autoKey === undefined ? 'missing' : await write(autoKey, !was)).toBe('key.toggleAutoKey: finished');
    expect(app.prefs.getState().autoKey).toBe(!was);
  });

  it('the Rig writers: Opens with Rig until the chunk registers them, then they write', async () => {
    const brush = control('rigging.brush.radiusPx');
    expect([brush.op, brush.disabledReason, brush.presentation]).toEqual(['skin.paint.set', 'Opens with Rig', 'none']);
    expect(brush.write(40)).toBeNull();
    const rig = settingsSections(app).find((s) => s.id === 'rigging');
    expect(rig?.links).toContainEqual({ kind: 'stage', label: 'Switch to Rig ▸', stage: 'rig' });
    await app.rig.load();
    expect(control('rigging.brush.radiusPx').disabledReason).toBeNull();
    expect(await write(control('rigging.brush.radiusPx'), 40)).toBe('skin.paint.set: finished');
    expect(app.prefs.getState().rigging.brush.radiusPx).toBe(40);
    expect(await write(control('rigging.brush.opacity'), 50)).toBe('skin.paint.set: finished');
    expect(app.prefs.getState().rigging.brush.opacity).toBeCloseTo(0.5, 12);
    // `rig.jointSize.set` is the host's Rig registration (not the kernel chunk): still waiting headless.
    expect(control('rigging.jointSize').disabledReason).toBe('Opens with Rig');
  });

  it("an iPad's device override shows the effective undo budget with a note naming the user's own", () => {
    const own = app.prefs.getState().modeling.undoBudgetMB;
    const dispose = overridePrefs(app.prefs, 'device', { modeling: { undoBudgetMB: 96 } });
    const budget = control('modeling.undoBudgetMB');
    expect(budget.value).toBe(96);
    expect(budget.note).toContain('96 MB');
    expect(budget.note).toContain(`${own} MB`);
    expect(control('modeling.journalBudgetMB').note).toBeNull();
    dispose();
    expect(control('modeling.undoBudgetMB').note).toBeNull();
  });
});

describe('shared Studio Pro preferences (§16.4)', () => {
  it('are labelled as Studio Pro settings on every row that shows one', () => {
    const shared = PREF_DESCRIPTORS.filter((d) => d.shared === true && d.hidden === undefined).map((d) => d.path);
    expect([...shared].sort()).toEqual(['navProfile', 'spaceBehaviour', 'uiScale']);
    expect(shared.filter((path) => !control(path).shared)).toEqual([]);
    expect(control('spaceBehaviour').label).toContain('Studio Pro');
    const autoKey = settingsControls(app).find((entry) => entry.control.op === 'key.toggleAutoKey')?.control;
    expect(autoKey?.label).toContain('Studio Pro');
    // Halo's own preferences are not shared rows.
    expect(control('graphHandles').shared).toBe(false);
  });

  it('Settings › Input leaves the slot for Halo’s own input settings, Start in explains and links the chooser', () => {
    const sections = settingsSections(app);
    expect(sections.find((s) => s.id === 'input')?.slot).toBe('halo.input');
    const startIn = sections.find((s) => s.id === 'startIn');
    expect(startIn?.controls).toEqual([]);
    expect(startIn?.links).toContainEqual({ kind: 'href', label: 'Open the chooser ▸', href: '/?chooser=1' });
    expect(sections.find((s) => s.id === 'keyboard')?.links).toContainEqual({
      kind: 'sheet',
      label: 'All shortcuts ▸',
      sheet: 'help',
      section: 'shortcuts',
    });
  });
});

describe('the Disclosure Manifest’s Settings entries (§20.5)', () => {
  it('every operator placed in Settings has a control in its section, and ui.open preferences opens it', () => {
    const sections = settingsSections(app);
    const placed: { readonly op: string; readonly surface: Extract<SurfaceRef, { readonly sheet: unknown }> }[] = [];
    for (const [op, entry] of Object.entries(DISCLOSURE)) {
      for (const disclosure of entriesOf(entry).filter(isSurfaceEntry)) {
        for (const surface of disclosure.surfaces) {
          if ('sheet' in surface && surface.sheet === 'settings') placed.push({ op, surface });
        }
      }
    }
    expect(placed.map((p) => p.op).sort()).toEqual(['key.toggleAutoKey', 'prefs.set', 'ui.open', 'view.setNavProfile']);
    const missing = placed
      .filter(({ op, surface }) => {
        const where =
          surface.section === undefined ? sections : sections.filter((section) => section.id === surface.section);
        if (op === 'ui.open') return where.length === 0;
        return !where.some((section) => section.controls.some((c) => c.op === op));
      })
      .map(({ op, surface }) => `${op} › ${surface.section ?? '(any)'}`);
    expect(missing).toEqual([]);
    expect(DIALOG_SURFACES.preferences).toEqual({ sheet: 'settings' });
  });
});
