// AUTORIG-SPEC §3.4, §4.4 (D1): the host's navigation port — route URLs keep the page's switches (e2e, `ns`, …) and
// drop the previous arrival's; a same-page `go` lets the leaving shell close its menus, closes the host's dialog,
// palette and keyboard state, then pushes, and the arriving shell reads the subject and workspace once; the chooser
// is a page load; the new-tab flow opens its tab synchronously (inside the gesture) and hands over a record, and a
// failed hand-over closes that tab and says why; without a client router a switch hands over in this tab.
import { GLOBAL_SCOPE, type NavigationRequest } from '@ekza-studio/editor-core';
import { createFakeEditorApp } from '@ekza-studio/editor-core/testing';
import { describe, expect, it } from 'vitest';
import { createHostShell } from '../src/host/createHost';
import { routeHref } from '../src/host/navigation';
import type { MountedShell } from '../src/host/types';
import { createToastNotifier } from '../src/services/notify';
import { DEFAULT_PARAMS } from '../src/test-api/params';
import { createTestShell, waitFor } from './shell-helpers';

describe('routeHref (§3.1)', () => {
  it.each([
    [{ to: 'studio' }, '?e2e=1&ns=a', '/editor?e2e=1&ns=a'],
    [{ to: 'studio', workspace: 'animate', from: 'autorig' }, '?e2e=1', '/editor?e2e=1&ws=animate&from=autorig'],
    [{ to: 'autorig', from: 'studio' }, '?e2e=1&ws=rig&handoff=x&step=rig', '/autorig?e2e=1&from=studio'],
    [{ to: 'autorig', workspace: 'rig' }, '', '/autorig'],
    [{ to: 'chooser' }, '?e2e=1', '/?chooser=1'],
  ] as [NavigationRequest, string, string][])('%j from %s → %s', (request, search, href) => {
    expect(routeHref(request, search)).toBe(href);
  });
});

interface FakeTab {
  readonly location: { href: string };
  closed: boolean;
  close(): void;
}

function setup(opts: { readonly push?: boolean; readonly search?: string } = {}) {
  const toasts = createToastNotifier();
  const app = createFakeEditorApp({ services: { notify: toasts } });
  const pushed: string[] = [];
  const assigned: string[] = [];
  const tabs: FakeTab[] = [];
  const location = { search: opts.search ?? '?e2e=1&ns=n1', assign: (url: string) => void assigned.push(url) };
  const host = createHostShell({
    app,
    params: DEFAULT_PARAMS,
    storage: null,
    toasts,
    navigation: {
      push: opts.push === false ? undefined : (href) => void pushed.push(href),
      location,
      open: () => {
        const tab: FakeTab = {
          location: { href: 'about:blank' },
          closed: false,
          close() {
            this.closed = true;
          },
        };
        tabs.push(tab);
        return tab as unknown as Window;
      },
    },
  });
  return { app, host, toasts, pushed, assigned, tabs };
}

describe('the navigation port (§4.4)', () => {
  it('a same-page switch closes what the leaving shell and the host show, pushes, and hands over once', async () => {
    const { app, host, pushed } = setup();
    let left = 0;
    const shell: MountedShell = { kind: 'studio', leave: () => void (left += 1) };
    host.mount(shell);
    app.session.setState({ dialog: 'about' });
    const subject = { character: null, meshes: ['msh_a' as never] };
    await host.navigation.go({ to: 'autorig', from: 'studio', subject, workspace: 'rig' });
    expect(pushed).toEqual(['/autorig?e2e=1&ns=n1&from=studio']);
    expect(left).toBe(1);
    await waitFor(() => app.session.getState().dialog === null);
    expect(host.navigation.takeSubject()).toEqual(subject);
    expect(host.navigation.takeSubject()).toBeNull();
    expect(host.navigation.takeWorkspace()).toBe('rig');
    expect(host.navigation.takeWorkspace()).toBeNull();
    host.dispose();
  });

  it("Studio's leave() stops the library preview, then ends the tool session with Esc semantics (§4.4)", async () => {
    const { app, shell } = createTestShell();
    const ran: string[] = [];
    const stub = (id: 'library.stop' | 'edit.escape') =>
      app.contribute({
        kind: 'operator',
        def: { id, label: id, category: 'test', scope: GLOBAL_SCOPE, apply: () => void ran.push(id) },
      });
    // Before the clip library loaded there is no `library.stop`: leave() skips it and never reports an unknown id.
    const escape = stub('edit.escape');
    shell.leave?.();
    await waitFor(() => ran.length === 1);
    expect(ran).toEqual(['edit.escape']);
    const stop = stub('library.stop');
    shell.leave?.();
    await waitFor(() => ran.length === 3);
    expect(ran.slice(1)).toEqual(['library.stop', 'edit.escape']);
    stop();
    escape();
    shell.dispose();
  });

  it('the chooser is a page load', async () => {
    const { host, pushed, assigned } = setup();
    await host.navigation.go({ to: 'chooser' });
    expect([pushed, assigned]).toEqual([[], ['/?chooser=1']]);
    host.dispose();
  });

  it('the new tab opens inside the gesture; a failed hand-over closes it and says why', async () => {
    const { host, tabs, pushed, toasts } = setup();
    const going = host.navigation.go({ to: 'studio', workspace: 'animate', newTab: true });
    // synchronously, before any await: a tab opened later would be a blocked pop-up
    expect(tabs.length).toBe(1);
    await going;
    // the fake app has no autosave store: no record can be written
    expect(tabs[0]?.closed).toBe(true);
    expect(pushed).toEqual([]);
    expect(toasts.store.getState().toasts.map((toast) => [toast.kind, toast.text])).toEqual([
      ['error', 'Could not open Studio: Opening in another tab needs browser storage, which is blocked here'],
    ]);
    host.dispose();
  });

  it('without a client router a switch hands over in this tab (the page-load fallback)', async () => {
    const { host, tabs, pushed, assigned, toasts } = setup({ push: false });
    await host.navigation.go({ to: 'autorig' });
    expect([tabs.length, pushed, assigned]).toEqual([0, [], []]);
    expect(toasts.store.getState().toasts[0]?.text).toMatch(/^Could not open Auto-Rig: /);
    host.dispose();
  });

  it('is the app’s navigation port while the host lives', async () => {
    const { app, host } = setup();
    const { hostNavigation } = await import('@ekza-studio/editor-core');
    expect(hostNavigation(app)).toBe(host.navigation);
    host.dispose();
    expect(hostNavigation(app)).toBeNull();
  });
});
