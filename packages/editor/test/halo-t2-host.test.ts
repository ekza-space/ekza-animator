// STUDIO-TOUCH-SPEC §16, §20.3 items 11 and 13, §20.4 (T2): the host's side of the third shell. Every route is mapped
// explicitly (`/app` for Halo, its workspace as `ws`, a stale `stage` dropped); a same-page `go` hands over the arrival
// action and — only when Halo leaves — Halo's state, each read once; a received record's `then` and `halo` become the
// arrival's; the new-tab flow names Ekza Studio when its record cannot be written; `from=halo` is a URL label; after a
// touch or pen press the key scope is the last pressed panel, after a mouse it is the hovered one again.
import { GLOBAL_SCOPE, type HandoffInfo, type NavigationRequest } from '@ekza-studio/editor-core';
import { createFakeEditorApp } from '@ekza-studio/editor-core/testing';
import { describe, expect, it } from 'vitest';
import { createHostShell } from '../src/host/createHost';
import { ROUTE_PATHS, routeHref } from '../src/host/navigation';
import type { MountedShell } from '../src/host/types';
import { createToastNotifier } from '../src/services/notify';
import { DEFAULT_PARAMS, parseEditorParams } from '../src/test-api/params';
import { waitFor } from './shell-helpers';

describe('routeHref with Halo (T2)', () => {
  it('maps every shell route explicitly', () => {
    expect(ROUTE_PATHS).toEqual({ studio: '/editor', autorig: '/autorig', halo: '/app' });
  });

  it.each([
    [{ to: 'halo' }, '?e2e=1&ns=a', '/app?e2e=1&ns=a'],
    [{ to: 'halo', from: 'studio', workspace: 'rig' }, '?e2e=1&ws=animate', '/app?e2e=1&ws=rig&from=studio'],
    [{ to: 'studio', from: 'halo', workspace: 'animate' }, '?e2e=1&stage=rig', '/editor?e2e=1&ws=animate&from=halo'],
    [{ to: 'autorig', from: 'halo', workspace: 'rig' }, '?stage=make&from=studio', '/autorig?from=halo'],
    [{ to: 'studio', then: { kind: 'dialog', dialog: 'export' } }, '', '/editor'],
  ] as [NavigationRequest, string, string][])('%j from %s → %s', (request, search, href) => {
    expect(routeHref(request, search)).toBe(href);
  });

  it('reads from=halo as a label in any build', () => {
    expect(parseEditorParams('?from=halo', false).from).toBe('halo');
    expect(parseEditorParams('?from=app', false).from).toBeNull();
  });
});

function setup() {
  const toasts = createToastNotifier();
  const app = createFakeEditorApp({ services: { notify: toasts } });
  const pushed: string[] = [];
  const tabs: { location: { href: string }; closed: boolean; close(): void }[] = [];
  const host = createHostShell({
    app,
    params: DEFAULT_PARAMS,
    storage: null,
    toasts,
    navigation: {
      push: (href) => void pushed.push(href),
      location: { search: '?e2e=1', assign: () => {} },
      open: () => {
        const tab = {
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
  return { app, host, toasts, pushed, tabs };
}

describe('the navigation port with Halo (T2)', () => {
  it('a switch from Halo commits it first, then hands over its state and the arrival action once', async () => {
    const { host, pushed } = setup();
    const order: string[] = [];
    const halo: MountedShell = {
      kind: 'halo',
      leave: () => void order.push('leave'),
      haloState: () => {
        order.push('state');
        return { stage: 'animate', threadLayer: 2 };
      },
    };
    host.mount(halo);
    await host.navigation.go({ to: 'studio', from: 'halo', workspace: 'animate', then: { kind: 'preset', preset: 'polish' } });
    expect(pushed).toEqual(['/editor?e2e=1&ws=animate&from=halo']);
    expect(order).toEqual(['leave', 'state']);
    expect(host.navigation.takeThen()).toEqual({ kind: 'preset', preset: 'polish' });
    expect(host.navigation.takeThen()).toBeNull();
    expect(host.navigation.takeHalo()).toEqual({ stage: 'animate', threadLayer: 2 });
    expect(host.navigation.takeHalo()).toBeNull();
    expect(host.navigation.takeWorkspace()).toBe('animate');
    host.dispose();
  });

  it('another leaving shell hands over no Halo state, and a later switch replaces what was not read', async () => {
    const { host } = setup();
    const halo: MountedShell = { kind: 'halo', haloState: () => ({ stage: 'rig', fingers: 'mittens' }) };
    const dispose = host.mount(halo);
    await host.navigation.go({ to: 'autorig', from: 'halo', then: { kind: 'dialog', dialog: 'export' } });
    dispose();
    host.mount({ kind: 'studio' });
    await host.navigation.go({ to: 'halo', from: 'studio' });
    expect(host.navigation.takeHalo()).toBeNull();
    expect(host.navigation.takeThen()).toBeNull();
    host.dispose();
  });

  it("a received record's arrival action and Halo state become the arrival's", () => {
    const { host } = setup();
    const info: HandoffInfo = {
      route: 'studio',
      workspace: 'animate',
      subject: null,
      autorig: null,
      halo: { stage: 'animate', sheet: 'share' },
      then: { kind: 'dialog', dialog: 'export' },
      createdAt: 1,
    };
    host.navigation.arrive(info);
    expect(host.navigation.takeThen()).toEqual({ kind: 'dialog', dialog: 'export' });
    expect(host.navigation.takeHalo()).toEqual({ stage: 'animate', sheet: 'share' });
    expect(host.navigation.takeHandoffInfo()).toBe(info);
    // a record of an earlier build carries neither
    host.navigation.arrive({ route: 'autorig', workspace: null, subject: null, autorig: null, createdAt: 2 });
    expect([host.navigation.takeThen(), host.navigation.takeHalo()]).toEqual([null, null]);
    host.dispose();
  });

  it('the new-tab flow to Halo opens its tab in the gesture and names Ekza Studio when the record fails', async () => {
    const { host, tabs, pushed, toasts } = setup();
    const going = host.navigation.go({ to: 'halo', from: 'studio', newTab: true });
    expect(tabs.length).toBe(1);
    await going;
    expect([tabs[0]?.closed, pushed]).toEqual([true, []]);
    expect(toasts.store.getState().toasts.map((toast) => toast.text)).toEqual([
      'Could not open Ekza Studio: Opening in another tab needs browser storage, which is blocked here',
    ]);
    host.dispose();
  });
});

describe('the key scope after touch and pen (T2, §20.3 item 13)', () => {
  it('follows the last pressed panel after a touch or pen press, the hovered one after a mouse', async () => {
    const { app, host } = setup();
    const ran: { op: string; panel: string | undefined }[] = [];
    for (const id of ['test.graphKey', 'test.globalKey'] as const) {
      app.contribute({
        kind: 'operator',
        def: { id, label: id, category: 'test', scope: GLOBAL_SCOPE, apply: (ctx) => void ran.push({ op: id, panel: ctx.panel }) },
      });
    }
    app.contribute({
      kind: 'keymap',
      bindings: [
        { chord: { code: 'KeyQ' }, op: 'test.graphKey', scope: 'graph' },
        { chord: { code: 'KeyQ' }, op: 'test.globalKey', scope: GLOBAL_SCOPE },
      ],
    });
    // the Graph Editor was pressed last; the pointer then left (WebKit: `pointerleave` after a lift)
    host.ui.setState({ hover: null, lastPanel: { kind: 'graph', scope: 'graph', instanceId: null, paneId: null } });
    const press = async (count: number): Promise<void> => {
      host.keyboard.keyDown(new KeyboardEvent('keydown', { code: 'KeyQ', key: 'q', cancelable: true }));
      host.keyboard.keyUp(new KeyboardEvent('keyup', { code: 'KeyQ', key: 'q', cancelable: true }));
      await waitFor(() => ran.length === count);
    };
    await press(1); // today's rule (a mouse): no hovered panel, the global binding
    host.notePointer('touch');
    await press(2);
    host.notePointer('pen');
    await press(3);
    host.notePointer('mouse');
    await press(4);
    expect(ran.map((run) => run.op)).toEqual(['test.globalKey', 'test.graphKey', 'test.graphKey', 'test.globalKey']);
    expect(ran[1]?.panel).toBe('graph');
    host.dispose();
  });
});
