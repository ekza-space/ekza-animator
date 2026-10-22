// AUTORIG-SPEC §4.5 (D1): `autorig.navigate` wraps the host's navigation port (`provideNavigation`,
// `hostNavigation`): without a port it refuses "No navigation in this host"; with one it forwards the request once,
// records no history step and leaves the document alone; bad arguments refuse with their reason.
import { describe, expect, it } from 'vitest';
import { hostNavigation, type NavigationRequest, provideNavigation } from '../../src';
import { NO_NAVIGATION } from '../../src/operators/builtin/rig/wizard/navigate';
import { opsApp } from '../builtin/support';

function recordingPort(): { readonly calls: NavigationRequest[]; readonly port: Parameters<typeof provideNavigation>[1] } {
  const calls: NavigationRequest[] = [];
  return { calls, port: { go: async (request) => void calls.push(request), takeSubject: () => null } };
}

describe('autorig.navigate (AUTORIG-SPEC §4.5, D1)', () => {
  it('refuses without a navigation port (headless hosts)', async () => {
    const app = opsApp();
    expect(hostNavigation(app)).toBeNull();
    expect(await app.runUntyped('autorig.navigate', { to: 'studio' })).toEqual({
      status: 'cancelled',
      reason: NO_NAVIGATION,
    });
  });

  it('forwards the request to the port once, records no history step and keeps the document', async () => {
    const app = opsApp();
    const { calls, port } = recordingPort();
    const dispose = provideNavigation(app, port);
    expect(hostNavigation(app)).toBe(port);
    const version = app.store.version;
    const result = await app.runUntyped('autorig.navigate', {
      to: 'studio',
      workspace: 'animate',
      from: 'autorig',
      newTab: true,
    });
    expect(result.status).toBe('finished');
    expect(calls).toEqual([{ to: 'studio', workspace: 'animate', from: 'autorig', newTab: true }]);
    expect(app.history.peekUndo()).toBeNull();
    expect(app.store.version).toBe(version);
    dispose();
    expect(hostNavigation(app)).toBeNull();
  });

  it('a disposer of a replaced port leaves the newer port in place', () => {
    const app = opsApp();
    const first = recordingPort().port;
    const second = recordingPort().port;
    const disposeFirst = provideNavigation(app, first);
    provideNavigation(app, second);
    disposeFirst();
    expect(hostNavigation(app)).toBe(second);
  });

  it.each([
    [undefined, "expects { to: 'autorig' | 'studio' | 'chooser' }"],
    [{ to: 'editor' }, "expects { to: 'autorig' | 'studio' | 'chooser' }"],
    [{ to: 'studio', workspace: 3 }, 'workspace must be a workspace id'],
    [{ to: 'studio', from: 'landing' }, "from must be 'studio' or 'autorig'"],
    [{ to: 'autorig', newTab: 'yes' }, 'newTab must be true or false'],
  ])('refuses %j with its reason', async (args, reason) => {
    const app = opsApp();
    const { calls, port } = recordingPort();
    provideNavigation(app, port);
    expect(await app.runUntyped('autorig.navigate', args)).toEqual({ status: 'cancelled', reason });
    expect(calls).toEqual([]);
  });
});
