// STUDIO-TOUCH-SPEC §20.3 item 11 (T2): `shell.navigate` is the host-level switch of every route. The built-ins never
// register it (a headless app has no navigation); the host does (`registerShellNavigate`). Without a port it refuses;
// with one it forwards the request once — `then` included — records no history step and keeps the document; it is
// denied to agents; `autorig.navigate` keeps its three routes (no `halo`) and its messages.
import { describe, expect, it } from 'vitest';
import { type NavigationRequest, provideNavigation } from '../../src';
import { NO_SHELL_NAVIGATION, registerShellNavigate } from '../../src/operators/builtin/shellNavigate';
import { opsApp } from '../builtin/support';

function recordingPort(): {
  readonly calls: NavigationRequest[];
  readonly port: Parameters<typeof provideNavigation>[1];
} {
  const calls: NavigationRequest[] = [];
  return { calls, port: { go: async (request) => void calls.push(request), takeSubject: () => null } };
}

describe('shell.navigate (STUDIO-TOUCH-SPEC §20.3 item 11, T2)', () => {
  it('is the host’s: the built-ins never register it, the registration adds and removes it', () => {
    const app = opsApp();
    expect(app.operators.get('shell.navigate')).toBeUndefined();
    const dispose = registerShellNavigate(app);
    const def = app.operators.get('shell.navigate');
    expect(def?.label).toBe('Switch Layout');
    expect(def?.agent).toEqual({ policy: 'denied', reason: expect.any(String) });
    expect(def?.flags?.undo).toBeUndefined();
    dispose();
    expect(app.operators.get('shell.navigate')).toBeUndefined();
  });

  it('refuses without a navigation port', async () => {
    const app = opsApp();
    registerShellNavigate(app);
    expect(await app.runUntyped('shell.navigate', { to: 'halo' })).toEqual({
      status: 'cancelled',
      reason: NO_SHELL_NAVIGATION,
    });
  });

  it('forwards every field of the request once, records no history step and keeps the document', async () => {
    const app = opsApp();
    registerShellNavigate(app);
    const { calls, port } = recordingPort();
    provideNavigation(app, port);
    const version = app.store.version;
    const request = {
      to: 'studio',
      workspace: 'animate',
      from: 'halo',
      newTab: true,
      then: { kind: 'preset', preset: 'polish' },
    } as const;
    expect((await app.runUntyped('shell.navigate', request)).status).toBe('finished');
    expect((await app.runUntyped('shell.navigate', { to: 'halo', from: 'studio' })).status).toBe('finished');
    expect((await app.runUntyped('shell.navigate', { to: 'chooser' })).status).toBe('finished');
    expect(calls).toEqual([request, { to: 'halo', from: 'studio' }, { to: 'chooser' }]);
    expect(app.history.peekUndo()).toBeNull();
    expect(app.store.version).toBe(version);
  });

  it.each([
    [undefined, "expects { to: 'halo' | 'studio' | 'autorig' | 'chooser' }"],
    [{ to: 'editor' }, "expects { to: 'halo' | 'studio' | 'autorig' | 'chooser' }"],
    [{ to: 'halo', workspace: 3 }, 'workspace must be a workspace id'],
    [{ to: 'halo', from: 'chooser' }, "from must be 'halo' | 'studio' | 'autorig'"],
    [{ to: 'studio', newTab: 'yes' }, 'newTab must be true or false'],
    [{ to: 'studio', then: { kind: 'menu', menu: 'x' } }, "then expects { kind: 'preset' | 'panel' | 'dialog', <kind>: an id }"],
    [{ to: 'studio', then: { kind: 'dialog' } }, "then expects { kind: 'preset' | 'panel' | 'dialog', <kind>: an id }"],
  ])('refuses %j with its reason', async (args, reason) => {
    const app = opsApp();
    registerShellNavigate(app);
    const { calls, port } = recordingPort();
    provideNavigation(app, port);
    expect(await app.runUntyped('shell.navigate', args)).toEqual({ status: 'cancelled', reason });
    expect(calls).toEqual([]);
  });

  it('autorig.navigate keeps its routes: halo is not one of them', async () => {
    const app = opsApp();
    const { calls, port } = recordingPort();
    provideNavigation(app, port);
    expect(await app.runUntyped('autorig.navigate', { to: 'halo' })).toEqual({
      status: 'cancelled',
      reason: "expects { to: 'autorig' | 'studio' | 'chooser' }",
    });
    expect(await app.runUntyped('autorig.navigate', { to: 'studio', from: 'halo' })).toEqual({
      status: 'cancelled',
      reason: "from must be 'studio' or 'autorig'",
    });
    expect(calls).toEqual([]);
  });
});
