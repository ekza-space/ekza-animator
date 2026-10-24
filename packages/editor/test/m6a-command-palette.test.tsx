// M6A-SPEC §5.18 (B9): the command palette — fuzzy search over the operators visible in the current workspace
// (labels, ids, alternative-name aliases), menu items with arguments and "Workspace: …" entries, key labels and poll
// reasons, Enter runs (`source: 'palette'`), the inline prompt of operators with params, and the list UI.
import type { ParamDef } from '@ekza-studio/anim-core';
import {
  BUILTIN_MENU_ITEMS,
  type OperatorDef,
  type OperatorResult,
  registerBuiltinOperators,
  registerBuiltinWorkspaces,
  type RunContext,
} from '@ekza-studio/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-studio/editor-core/testing';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { CommandPaletteHost, createCommandPalette, PALETTE_LOAD_FAILED } from '../src/overlays/CommandPalette';
import {
  type CommandPaletteController,
  createCommandPaletteController,
  filterEntries,
  fuzzyScore,
  type PaletteEntry,
  paletteEntries,
  parseParam,
} from '../src/overlays/CommandPalette/controller';
import { byTestId, render, update } from './render';
import { waitFor } from './shell-helpers';

const DISTANCE: ParamDef = {
  name: 'localTranslateZ',
  label: 'Local Translate Z',
  kind: 'distance',
  bound: 'value',
  default: 0,
  primary: true,
};
const DIVISIONS: ParamDef = { name: 'divisions', label: 'Divisions', kind: 'int', bound: 'value', default: 1, min: 1 };
const FRACTION: ParamDef = { name: 'fraction', label: 'Fraction', kind: 'fraction', bound: 'value', default: 0.5 };
const ANGLE: ParamDef = { name: 'angle', label: 'Angle', kind: 'angle', bound: 'value', default: 0 };
const MODE: ParamDef = {
  name: 'mode',
  label: 'Mode',
  kind: 'enum',
  bound: 'value',
  default: 'relative',
  options: [
    { value: 'relative', label: 'Relative' },
    { value: 'multiple', label: 'Multiple' },
  ],
};

interface Rig {
  readonly app: FakeEditorApp;
  readonly controller: CommandPaletteController;
  readonly runs: { op: string; args: unknown; ctx: RunContext }[];
}

function rig(): Rig {
  const app = createFakeEditorApp();
  registerBuiltinOperators(app);
  registerBuiltinWorkspaces(app);
  for (const def of BUILTIN_MENU_ITEMS) if (app.menus.get(def.id) === undefined) app.contribute({ kind: 'menu', def });
  const extrude: OperatorDef = {
    id: 'test.extrude',
    label: 'Test Extrude',
    category: 'test',
    scope: 'global',
    aliases: ['Push Out'],
    params: [
      DIVISIONS,
      DISTANCE,
      { ...MODE },
      { name: 'seed', label: 'Seed', kind: 'data', bound: 'selection', default: null, nullable: true },
    ],
    workspaces: ['model'],
    apply() {},
  };
  app.contribute({ kind: 'operator', def: extrude });
  const runs: Rig['runs'] = [];
  const controller = createCommandPaletteController({
    app,
    run: (op, args, ctx) => {
      runs.push({ op, args, ctx });
      return Promise.resolve({ status: 'finished', value: undefined } as OperatorResult<unknown>);
    },
    context: () => ({ panel: 'viewport', paneId: 'pane-persp' }),
  });
  return { app, controller, runs };
}

const entry = (fields: Partial<PaletteEntry> & { label: string; op: string }): PaletteEntry => ({
  key: fields.op,
  args: undefined,
  aliases: [],
  shortcut: null,
  enabled: true,
  reason: null,
  params: [],
  testId: `cmdk-item-${fields.op}`,
  ...fields,
});

describe('fuzzy search', () => {
  it('ranks substrings (prefix and word starts first) above subsequences, and misses score 0', () => {
    expect(fuzzyScore('ext', 'Extrude')).toBeGreaterThan(fuzzyScore('ext', 'Context Menu'));
    expect(fuzzyScore('loop', 'Insert Edge Loop')).toBeGreaterThan(fuzzyScore('ielp', 'Insert Edge Loop'));
    expect(fuzzyScore('ielp', 'Insert Edge Loop')).toBeGreaterThan(0);
    expect(fuzzyScore('xyz', 'Extrude')).toBe(0);
    expect(fuzzyScore('', 'anything')).toBe(1);
  });

  it('matches labels, ids and aliases; enabled entries first at equal scores', () => {
    const entries = [
      entry({ label: 'Insert Edge Loop', op: 'mesh.insertLoop', aliases: ['Loop Cut'] }),
      entry({ label: 'Multi-Cut', op: 'view.tool', aliases: ['Knife'], key: 'k' }),
      entry({ label: 'Extrude', op: 'mesh.extrude', enabled: false, reason: 'Select faces or border edges' }),
      entry({ label: 'Extrude Too', op: 'mesh.extrude2' }),
    ];
    expect(filterEntries(entries, 'loop cut').map((e) => e.label)).toEqual(['Insert Edge Loop']);
    expect(filterEntries(entries, 'knife').map((e) => e.label)).toEqual(['Multi-Cut']);
    expect(filterEntries(entries, 'mesh.insert').map((e) => e.label)).toEqual(['Insert Edge Loop']);
    expect(filterEntries(entries, 'extrude').map((e) => e.label)).toEqual(['Extrude', 'Extrude Too']);
    expect(filterEntries(entries, '').length).toBe(4);
  });
});

describe('typed values (§5.10 units)', () => {
  it('parses fractions as fractions or percent, angles in degrees, ints rounded, enums by value or label', () => {
    expect(parseParam(FRACTION, '0.3')).toEqual({ value: 0.3 });
    expect(parseParam(FRACTION, '30%')).toEqual({ value: 0.3 });
    expect(parseParam(ANGLE, '90')).toEqual({ value: Math.PI / 2 });
    expect(parseParam(DIVISIONS, '2.6')).toEqual({ value: 3 });
    expect(parseParam(DISTANCE, '0.5 m')).toEqual({ value: 0.5 });
    expect(parseParam(DISTANCE, '')).toEqual({ value: 0 });
    expect(parseParam(MODE, 'Multiple')).toEqual({ value: 'multiple' });
    expect(parseParam(DISTANCE, 'abc')).toEqual({ error: 'Local Translate Z: type a number' });
    expect(parseParam(MODE, 'sideways')).toEqual({ error: 'Mode: one of Relative, Multiple' });
  });

  it('reads numbers with the shipped grammar (research 09 §6.4): units, decimal comma, expressions, relative', () => {
    const close = (result: ReturnType<typeof parseParam>): number => {
      if (!('value' in result) || typeof result.value !== 'number') throw new Error(JSON.stringify(result));
      return result.value;
    };
    // Angles are typed in degrees; `rad` and `deg` suffixes convert.
    expect(close(parseParam(ANGLE, '1.5rad'))).toBeCloseTo(1.5, 12);
    expect(close(parseParam(ANGLE, '30deg'))).toBeCloseTo(Math.PI / 6, 12);
    expect(close(parseParam(ANGLE, '45°'))).toBeCloseTo(Math.PI / 4, 12);
    expect(close(parseParam(ANGLE, '=45*2'))).toBeCloseTo(Math.PI / 2, 12);
    // Distances in metres; cm and mm convert (§5.10 `50cm`).
    expect(close(parseParam(DISTANCE, '10cm'))).toBeCloseTo(0.1, 12);
    expect(close(parseParam(DISTANCE, '50 cm'))).toBeCloseTo(0.5, 12);
    expect(close(parseParam(DISTANCE, '25mm'))).toBeCloseTo(0.025, 12);
    expect(close(parseParam(DISTANCE, '1,5'))).toBeCloseTo(1.5, 12);
    expect(close(parseParam(DISTANCE, '1,5cm'))).toBeCloseTo(0.015, 12);
    expect(close(parseParam(DISTANCE, '=2*0.25'))).toBeCloseTo(0.5, 12);
    expect(close(parseParam(DISTANCE, '1m + 20cm'))).toBeCloseTo(1.2, 12);
    // Relative forms count from the value the prompt started from.
    expect(close(parseParam(DISTANCE, '+=0.1', 0.4))).toBeCloseTo(0.5, 12);
    expect(close(parseParam(DISTANCE, '*=2', 0.4))).toBeCloseTo(0.8, 12);
    expect(close(parseParam(ANGLE, '+=10', Math.PI / 2))).toBeCloseTo((100 * Math.PI) / 180, 12);
    expect(close(parseParam(FRACTION, '+=10%', 0.5))).toBeCloseTo(0.6, 12);
    expect(close(parseParam(FRACTION, '=0.1*3'))).toBeCloseTo(0.3, 12);
    expect(parseParam(DIVISIONS, '2*1.6')).toEqual({ value: 3 });
    // Units the field does not take are refused, never silently dropped.
    expect(parseParam(DISTANCE, '10in')).toEqual({ error: 'Local Translate Z: type a number' });
    expect(parseParam(DISTANCE, '90deg')).toEqual({ error: 'Local Translate Z: type a number' });
    expect(parseParam(ANGLE, '10cm')).toEqual({ error: 'Angle: type a number' });
    expect(parseParam(FRACTION, '0.3rad')).toEqual({ error: 'Fraction: type a number' });
    expect(parseParam(DIVISIONS, '3m')).toEqual({ error: 'Divisions: type a number' });
    expect(parseParam(DISTANCE, '1/0')).toEqual({ error: 'Local Translate Z: type a number' });
  });
});

describe('palette entries (§5.18)', () => {
  it('lists operators of the current workspace, menu variants and workspaces; never internal operators', () => {
    const { app } = rig();
    const animate = paletteEntries(app, {});
    const keys = animate.map((e) => e.key);
    expect(keys).toContain('workspace.set:model');
    expect(animate.find((e) => e.key === 'workspace.set:model')?.label).toBe('Workspace: Model');
    // M6B-SPEC §3 rule 9 literal update: Rig & Skin is enabled; Review is the disabled workspace.
    expect(animate.find((e) => e.key === 'workspace.set:rig')).toMatchObject({ enabled: true });
    expect(animate.find((e) => e.key === 'workspace.set:review')).toMatchObject({
      enabled: false,
      reason: 'Arrives in V1',
    });
    expect(keys).toContain('ui.commandPalette');
    expect(keys).not.toContain('ui.markingMenu'); // internal
    expect(keys).not.toContain('test.extrude'); // Model only
    // Menu items with arguments are variants of their operator (`<op>:<menu item id>`).
    expect(keys.some((key) => key.includes(':') && !key.startsWith('workspace.set:'))).toBe(true);
    expect(animate.find((e) => e.key === 'ui.commandPalette')?.shortcut).toMatch(/K/);

    app.session.setState({ workspace: 'model' });
    const model = paletteEntries(app, {});
    const extrude = model.find((e) => e.key === 'test.extrude');
    expect(extrude?.testId).toBe('cmdk-item-test.extrude');
    // The prompt asks for the value params, the primary one first (selection/data params are never typed).
    expect(extrude?.params.map((param) => param.name)).toEqual(['localTranslateZ', 'divisions', 'mode']);
  });

  it('Enter runs the highlighted entry with source "palette" and closes; a disabled entry stays', () => {
    const { controller, runs } = rig();
    controller.open();
    // M6B-SPEC §3 rule 9 literal update: Review is the disabled workspace (Rig & Skin is enabled).
    controller.setQuery('workspace: review');
    expect(controller.items()[0]?.label).toBe('Workspace: Review');
    controller.choose();
    expect(runs).toEqual([]);
    expect(controller.state.getState().open).toBe(true);
    controller.setQuery('workspace: model');
    controller.choose();
    expect(runs).toEqual([
      {
        op: 'workspace.set',
        args: { workspace: 'model' },
        ctx: { panel: 'viewport', paneId: 'pane-persp', source: 'palette' },
      },
    ]);
    expect(controller.state.getState().open).toBe(false);
  });

  it('an operator with params prompts for its fields (Tab moves) and runs with the typed values', () => {
    const { app, controller, runs } = rig();
    app.session.setState({ workspace: 'model' });
    controller.open();
    controller.setQuery('push out');
    controller.choose();
    expect(controller.state.getState().prompt).toMatchObject({
      field: 'localTranslateZ',
      values: { localTranslateZ: '0', divisions: '1', mode: 'relative' },
    });
    controller.setField('0.5');
    controller.nextField(1);
    controller.setField('two');
    controller.submitPrompt();
    expect(controller.state.getState().prompt).toMatchObject({ field: 'divisions', error: 'Divisions: type a number' });
    controller.setField('2');
    controller.nextField(-1);
    expect(controller.state.getState().prompt?.field).toBe('localTranslateZ');
    controller.submitPrompt();
    expect(runs).toEqual([
      {
        op: 'test.extrude',
        args: { localTranslateZ: 0.5, divisions: 2, mode: 'relative' },
        ctx: { panel: 'viewport', paneId: 'pane-persp', source: 'palette' },
      },
    ]);
  });

  it('the prompt starts from the option box defaults (prefs.modeling.optionDefaults)', () => {
    const { app, controller } = rig();
    app.session.setState({ workspace: 'model' });
    const modeling = app.prefs.getState().modeling;
    app.prefs.setState({ modeling: { ...modeling, optionDefaults: { 'test.extrude': { divisions: 4 } } } });
    controller.open();
    controller.setQuery('test extrude');
    controller.choose();
    expect(controller.state.getState().prompt?.values['divisions']).toBe('4');
  });

  it('typed values in the prompt: units convert, relative entries count from the starting value', () => {
    const { app, controller, runs } = rig();
    app.session.setState({ workspace: 'model' });
    const modeling = app.prefs.getState().modeling;
    app.prefs.setState({ modeling: { ...modeling, optionDefaults: { 'test.extrude': { divisions: 4 } } } });
    controller.open();
    controller.setQuery('test extrude');
    controller.choose();
    controller.setField('50cm');
    controller.nextField(1);
    controller.setField('+=2');
    controller.submitPrompt();
    expect(runs.map((r) => r.args)).toEqual([{ localTranslateZ: 0.5, divisions: 6, mode: 'relative' }]);
  });
});

describe('the palette UI (§8.10 cmdk, cmdk-input, cmdk-item-<operatorId>)', () => {
  it('opens, filters as you type, moves with the arrows, runs with Enter and closes with Esc', async () => {
    const { app, runs } = rig();
    // The shell's facade: the controller and the list load on first use.
    const palette = createCommandPalette({
      app,
      run: (op, args, ctx) => {
        runs.push({ op, args, ctx });
        return Promise.resolve({ status: 'finished', value: undefined } as OperatorResult<unknown>);
      },
      context: () => ({ panel: 'viewport', paneId: 'pane-persp' }),
    });
    expect(palette.items()).toEqual([]);
    const view = await render(<CommandPaletteHost palette={palette} />);
    await update(() => palette.open());
    await waitFor(() => palette.controller() !== null);
    const controller = palette.controller() as CommandPaletteController;
    await waitFor(() => document.querySelector('[data-testid="cmdk"]') !== null);
    const input = byTestId(document.body, 'cmdk-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    await update(() => userEvent.type(input, 'workspace'));
    expect(controller.state.getState().query).toBe('workspace');
    // Same score: enabled entries first, then by label (Animate, Model, Rig & Skin; Review last). M6B-SPEC §3 rule 9:
    // Rig & Skin is enabled, Review is the disabled entry.
    expect(byTestId(document.body, 'cmdk-item-workspace.set:animate').getAttribute('aria-selected')).toBe('true');
    await update(() => userEvent.keyboard('{ArrowDown}'));
    const model = byTestId(document.body, 'cmdk-item-workspace.set:model');
    expect(model.getAttribute('aria-selected')).toBe('true');
    expect(byTestId(document.body, 'cmdk-item-workspace.set:review').getAttribute('aria-disabled')).toBe('true');
    expect(byTestId(document.body, 'cmdk-item-workspace.set:review').textContent).toContain('V1');
    await update(() => userEvent.keyboard('{ArrowDown}{ArrowUp}{Enter}'));
    expect(runs.map((r) => r.args)).toEqual([{ workspace: 'model' }]);
    expect(document.querySelector('[data-testid="cmdk"]')).toBeNull();
    await update(() => controller.open());
    await waitFor(() => document.querySelector('[data-testid="cmdk-input"]') !== null);
    await update(() => userEvent.keyboard('{Escape}'));
    expect(controller.state.getState().open).toBe(false);
    await view.unmount();
  });
});

/** Collects unhandled promise rejections while `fn` runs (and a moment after). */
async function unhandledDuring(fn: () => Promise<void>): Promise<unknown[]> {
  const reasons: unknown[] = [];
  const listener = (e: PromiseRejectionEvent): void => {
    reasons.push(e.reason);
    e.preventDefault();
  };
  window.addEventListener('unhandledrejection', listener);
  try {
    await fn();
    await new Promise((resolve) => setTimeout(resolve, 30));
  } finally {
    window.removeEventListener('unhandledrejection', listener);
  }
  return reasons;
}

describe('a failed load (offline after a redeploy)', () => {
  it('Mod+K says so on the help line, rejects nothing unhandled, and the next Mod+K tries again', async () => {
    const { app } = rig();
    const helps: { text: string; tone: string | undefined }[] = [];
    let online = false;
    let imports = 0;
    const palette = createCommandPalette({
      app,
      run: () => Promise.resolve({ status: 'finished', value: undefined } as OperatorResult<unknown>),
      context: () => ({}),
      help: (text, tone) => void helps.push({ text, tone }),
      importChunks: () => {
        imports += 1;
        if (!online) return Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
        return Promise.all([
          import('../src/overlays/CommandPalette/controller'),
          import('../src/overlays/CommandPalette/CommandPaletteView'),
        ]).then(([controller, view]) => ({ controller, view }));
      },
    });
    const unhandled = await unhandledDuring(async () => {
      palette.open();
      await waitFor(() => helps.length > 0);
      expect(helps).toEqual([{ text: PALETTE_LOAD_FAILED, tone: 'error' }]);
      expect(palette.controller()).toBeNull();
      expect(palette.state.getState().open).toBe(false);
      online = true;
      palette.open();
      await waitFor(() => palette.state.getState().open);
    });
    expect(unhandled).toEqual([]);
    expect(imports).toBe(2);
    expect(helps).toHaveLength(1);
    expect(palette.items().length).toBeGreaterThan(0);
  });
});
