// M6A-INT-13 (M6A-SPEC §5.27): the Model operators load with their chunk, as in the editor. This file imports no test
// kit (which installs the chunk up front), so its module graph starts with the proxies: a poll before the chunk says
// "Model tools are loading" and starts the load; a run awaits it and runs the real operator; the app then has the
// Model menu items. M6A-INT-14: `app.components` is a facade until the kernel (and the selection service) loads.
import { describe, expect, it } from 'vitest';
import { createKernelApp } from '../../src/app/kernel';
import { loadMeshKernel, meshKernel } from '../../src/mesh';
import {
  MODEL_OPERATOR_PROXIES,
  MODEL_TOOLS_LOADING,
  modelOperators,
  pendingModelOperator,
} from '../../src/operators/builtin/modelOps';
import { naiveKernelDeps } from '../../src/testing/deps';
import { createFakeServices } from '../../src/testing/services';
import { humanoidSkeleton, waveDoc } from '../testing/fixtures';

function app() {
  const deps = naiveKernelDeps(humanoidSkeleton());
  const store = deps.createStore();
  store.load(waveDoc());
  return createKernelApp({ services: createFakeServices(), store, prefDefaults: { firstRunDone: true } }, deps);
}

describe('the Model operators before and after their chunk (M6A-INT-13)', () => {
  it('a proxy polls "loading" and starts the load; a run awaits it; the menus follow', async () => {
    expect(modelOperators()).toBeNull();
    expect(meshKernel()).toBeNull();
    const a = app();
    const proxy = a.operators.get('select.mode');
    expect(proxy).toBe(MODEL_OPERATOR_PROXIES.select.find((def) => def.id === 'select.mode'));
    expect(proxy?.label).toBe('Selection Mode');
    expect(proxy?.workspaces).toEqual(['model']);
    expect(a.menus.list().some((item) => item.workspaces?.includes('model') === true)).toBe(false);
    // The metadata is there before the chunk (menus, keymap, palette); the behaviour is not.
    expect(a.operators.poll('select.mode', undefined, { mode: 'vertex' })).toEqual({
      ok: false,
      reason: MODEL_TOOLS_LOADING,
    });
    expect(pendingModelOperator(proxy as object)).not.toBeNull();
    // A run in Animate awaits the chunk and gets the real operator's refusal (B10: Model only).
    const result = await a.runUntyped('select.mode', { mode: 'vertex' });
    expect(result).toEqual({ status: 'cancelled', reason: 'Component modes are in the Model workspace' });
    expect(modelOperators()).not.toBeNull();
    expect(pendingModelOperator(proxy as object)).toBeNull();
    expect(a.operators.poll('select.mode', undefined, { mode: 'vertex' })).toEqual({
      ok: false,
      reason: 'Component modes are in the Model workspace',
    });
    // The same object in the registry is now the operator; the Model menu items registered with the load.
    expect(a.operators.get('select.mode')).toBe(proxy);
    expect(typeof proxy?.apply).toBe('function');
    expect(a.menus.list().some((item) => item.id === 'builtin.model.edit.adjustLast')).toBe(true);
    // An app made after the load gets the items at once.
    expect(
      app()
        .menus.list()
        .some((item) => item.id === 'builtin.model.edit.adjustLast'),
    ).toBe(true);
  });

  it('app.components answers without the kernel and becomes the service when it loads (M6A-INT-14)', async () => {
    const a = app();
    expect(a.components.version).toBe(0);
    expect(a.components.snapshot()).toMatchObject({ componentMode: 'object', hilite: [], meshes: {} });
    expect(a.components.restore({ ...a.components.snapshot(), meshes: { msh_A: {} as never } })).toEqual({
      skipped: ['msh_A'],
    });
    expect(() => a.components.set('msh_A' as never, {} as never)).toThrow(
      expect.objectContaining({ code: 'invalid-record' }),
    );
    const internals = (): unknown =>
      (a.components as unknown as Record<symbol, unknown>)[Symbol.for('ekza.componentSelection.internals')];
    expect(internals()).toBeUndefined();
    await loadMeshKernel();
    // The service exists now: its internals (`componentInternals`) answer through the facade.
    expect(internals()).toBeDefined();
    expect(a.components.version).toBe(0);
  });
});
