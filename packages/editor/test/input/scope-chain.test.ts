// B0b (M6A-SPEC §5.17): the adapter's scope chain under the pointer, the test API's `resolveKey` over it, and the
// help line's resolved meanings.
import { type ComponentMode, registerBuiltinOperators } from '@ekza-studio/editor-core';
import { afterEach, describe, expect, it } from 'vitest';
import { helpHints, keyHints, scopeChain } from '../../src/input/keyboard';
import { shellWorkspacesTestApi } from '../../src/test-api/m6a/shell-workspaces';
import { createTestShell, type TestShell } from '../shell-helpers';
import { TEST_MODEL_WORKSPACE } from './support';

const shells: TestShell[] = [];
afterEach(() => {
  for (const test of shells.splice(0)) test.shell.dispose();
});

function setup(platform: 'mac' | 'other' = 'other'): TestShell {
  const test = createTestShell({ platform });
  registerBuiltinOperators(test.app);
  test.app.contribute({ kind: 'workspace', def: TEST_MODEL_WORKSPACE });
  shells.push(test);
  return test;
}

function enter(test: TestShell, workspace: 'model' | 'animate', mode: ComponentMode = 'object'): void {
  const state = test.app.session.getState();
  test.app.session.setState({ workspace, model: { ...state.model, componentMode: mode } });
}

const PANE = { kind: 'viewport', scope: 'viewport', paneId: 'pane-persp' } as const;
const OUTLINER = { kind: 'outliner', scope: 'outliner', paneId: null } as const;

describe('scopeChain', () => {
  it('Model face mode over a pane', () => {
    const test = setup();
    enter(test, 'model', 'face');
    expect(scopeChain(test.app, PANE)).toEqual({
      scopes: ['model.viewport.face', 'model.viewport.component', 'model.viewport', 'viewport', 'model', 'global'],
      panel: 'viewport',
      paneId: 'pane-persp',
    });
  });

  it('Model over the Outliner, outside every panel, and object mode over a pane', () => {
    const test = setup();
    enter(test, 'model', 'edge');
    expect(scopeChain(test.app, OUTLINER).scopes).toEqual(['model.outliner', 'outliner', 'model', 'global']);
    expect(scopeChain(test.app, null)).toEqual({ scopes: ['model', 'global'], panel: null, paneId: null });
    enter(test, 'model', 'object');
    expect(scopeChain(test.app, PANE).scopes).toEqual(['model.viewport', 'viewport', 'model', 'global']);
  });

  it('Animate is unchanged: `<panel>` → `global`, whatever the remembered component mode', () => {
    const test = setup();
    enter(test, 'animate', 'face');
    expect(scopeChain(test.app, PANE).scopes).toEqual(['viewport', 'global']);
    expect(scopeChain(test.app, OUTLINER).scopes).toEqual(['outliner', 'global']);
    expect(scopeChain(test.app, null).scopes).toEqual(['global']);
    expect(scopeChain(test.app, { kind: 'global', scope: 'global', paneId: null }).scopes).toEqual(['global']);
  });

  it('a workspace that is not registered falls back to the Animate chain', () => {
    const test = setup();
    test.app.session.setState({ workspace: 'review' });
    expect(scopeChain(test.app, PANE).scopes).toEqual(['viewport', 'global']);
  });
});

describe('test API resolveKey (E2E-MOD-03 probe)', () => {
  it('resolves Mod+E to mesh.extrude in Model over the pane and the Outliner, to Export in Animate', () => {
    const test = setup();
    const api = shellWorkspacesTestApi({ shell: test.shell, sync: () => {} });
    enter(test, 'model', 'face');
    expect(api.resolveKey({ code: 'KeyE', mod: true }, { panel: 'viewport', paneId: 'pane-persp' })).toEqual({
      op: 'mesh.extrude',
      args: undefined,
      scope: 'model',
    });
    expect(api.resolveKey({ code: 'KeyE', mod: true }, { panel: 'outliner' })?.op).toBe('mesh.extrude');
    expect(api.resolveKey({ code: 'KeyD', mod: true }, { panel: 'viewport', paneId: 'pane-persp' })?.op).toBe(
      'mesh.duplicateFaces',
    );
    enter(test, 'animate');
    expect(api.resolveKey({ code: 'KeyE', mod: true }, { panel: 'viewport', paneId: 'pane-persp' })).toEqual({
      op: 'ui.open',
      args: { dialog: 'export' },
      scope: 'global',
    });
  });
});

describe('help line hints (resolved meaning under the pointer)', () => {
  it('Model face mode over a pane, labelled for the platform', () => {
    const other = setup('other');
    enter(other, 'model', 'face');
    expect(helpHints(other.app, PANE)).toBe(
      'Ctrl+E Extrude · Ctrl+B Bevel · B Soft Select · K Multi Cut · M Merge menu · G Repeat Last · T Adjust Last Operation',
    );
    const mac = setup('mac');
    enter(mac, 'model', 'face');
    expect(helpHints(mac.app, PANE)?.startsWith('⌘E Extrude · ⌘B Bevel · B Soft Select')).toBe(true);
  });

  it('names the registered tool by its label', () => {
    const test = setup();
    enter(test, 'model', 'object');
    test.app.contribute({
      kind: 'tool',
      def: { id: 'multiCut', panel: 'viewport', label: 'Multi-Cut', create: () => ({}) },
    });
    expect(keyHints(test.app, scopeChain(test.app, PANE).scopes)).toEqual([
      'Ctrl+E Extrude',
      'B Soft Select',
      'K Multi-Cut',
      'G Repeat Last',
      'T Adjust Last Operation',
    ]);
  });

  it('over the Outliner only what runs there; nothing in Animate (its help line keeps the shipped hints)', () => {
    const test = setup();
    enter(test, 'model', 'face');
    expect(helpHints(test.app, OUTLINER)).toBe('Ctrl+E Extrude');
    enter(test, 'animate');
    expect(helpHints(test.app, PANE)).toBeNull();
  });
});
