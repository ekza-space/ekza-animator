// AUTORIG-SPEC §4.4 (D1): one StudioHost per page, the route's shell below it. Swapping Studio's shell for another
// shell keeps the host, the app, its history and the test API; Studio's own operators (workspace, presets, maximize)
// leave with its shell while the host's (dialogs, preferences) stay; the first-run dialog opens only when Studio's
// shell mounts as the page's first shell (never over a switch from Auto-Rig, AR-D8-6); the mounted shell is what the host's dialog layer and overlay port see. Under StrictMode the host
// boots one app.
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-studio/editor-core/testing';
import { type JSX, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useHost } from '../src/host/context';
import { StudioHost } from '../src/host/StudioHost';
import type { HostShell } from '../src/host/types';
import { StudioShell } from '../src/shell/EditorShell';
import { DEFAULT_PARAMS } from '../src/test-api/params';
import { createSyntheticModelLoader } from '../src/testing/syntheticModels';
import { liveEnvironment, settle, waitFor } from './shell-helpers';

let restore: () => void = () => {};
beforeAll(() => {
  restore = liveEnvironment();
});
afterAll(() => restore());

/** A stand-in for the Auto-Rig shell: mounts itself in the host and renders a marker. */
function OtherShell(): JSX.Element {
  const host = useHost();
  useEffect(() => host.mount({ kind: 'autorig' }), [host]);
  return <main data-testid="other-shell" />;
}

type Which = 'studio' | 'other' | null;

function Page(props: {
  readonly which: Which;
  readonly onApp: (app: FakeEditorApp) => void;
  readonly onHost: (host: HostShell) => undefined;
  readonly firstRun?: boolean;
}): JSX.Element {
  return (
    <StudioHost
      params={{ ...DEFAULT_PARAMS, e2e: true, firstRun: props.firstRun === true }}
      onHost={props.onHost}
      createApp={({ services, platform }) => {
        const app = createFakeEditorApp({ services: { ...services, models: createSyntheticModelLoader() }, platform });
        props.onApp(app);
        return app;
      }}
    >
      {props.which === 'studio' ? <StudioShell /> : props.which === 'other' ? <OtherShell /> : null}
    </StudioHost>
  );
}

function harness(strict = false, firstRun = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const root: Root = createRoot(container);
  const apps: FakeEditorApp[] = [];
  let host: HostShell | null = null;
  const onApp = (app: FakeEditorApp): void => void apps.push(app);
  const onHost = (mounted: HostShell): undefined => {
    host = mounted;
    return undefined;
  };
  const show = (which: Which): void => {
    const page = <Page which={which} onApp={onApp} onHost={onHost} firstRun={firstRun} />;
    root.render(strict ? <StrictMode>{page}</StrictMode> : page);
  };
  return {
    apps,
    host: (): HostShell => {
      if (host === null) throw new Error('no host yet');
      return host;
    },
    show,
    async unmount(): Promise<void> {
      root.unmount();
      container.remove();
      await settle(30);
    },
  };
}

const present = (id: string): boolean => document.querySelector(`[data-testid="${id}"]`) !== null;

describe('StudioHost with a switchable shell (§4.4)', () => {
  it('keeps the app, its history and the test API; Studio’s operators leave and return with its shell', async () => {
    const page = harness();
    page.show('studio');
    await waitFor(() => present('editor-shell') && window.__EKZA_STUDIO_TEST__ !== undefined);
    const host = page.host();
    const app = host.app;
    const api = window.__EKZA_STUDIO_TEST__;
    expect(host.mounted.getState()?.kind).toBe('studio');
    expect(app.operators.get('workspace.reset')).toBeDefined();
    expect(app.operators.get('ui.open')).toBeDefined();
    const versionAtStart = api?.state().storeVersion ?? Number.NaN;
    app.store.transact({ label: 'Step one' }, () => {});
    const historyBefore = api?.history();
    const versionBefore = api?.state().storeVersion;
    expect(versionBefore).toBe(app.store.version);
    expect(versionBefore).toBeGreaterThanOrEqual(versionAtStart);

    page.show('other');
    await waitFor(() => present('other-shell') && !present('editor-shell'));
    await settle(30); // Studio's shell is disposed a task after it unmounts
    expect(page.apps.length).toBe(1);
    expect(page.host()).toBe(host);
    expect(host.mounted.getState()?.kind).toBe('autorig');
    expect(app.operators.get('workspace.reset')).toBeUndefined();
    // the host's since T6-INT: the pane form works with Pro unmounted, the panel form finds no panel and does nothing
    expect(app.operators.get('view.toggleMaximize')).toBeDefined();
    expect((await api?.run('view.toggleMaximize', { paneId: 'pane-single' }))?.status).toBe('finished');
    expect(app.session.getState().maximizedPane).toBe('pane-single');
    expect((await api?.run('view.toggleMaximize', { paneId: 'pane-single' }))?.status).toBe('finished');
    expect(app.session.getState().maximizedPane).toBeNull();
    expect((await api?.run('view.toggleMaximize', { panel: 'graph' }))?.status).toBe('finished');
    expect(app.operators.get('ui.open')).toBeDefined();
    expect(app.operators.get('prefs.set')).toBeDefined();
    expect(window.__EKZA_STUDIO_TEST__).toBe(api);
    expect(api?.history()).toEqual(historyBefore);
    expect(api?.state().storeVersion).toBe(versionBefore);
    // the host's dialogs open on any route
    expect((await api?.run('ui.open', { dialog: 'about' }))?.status).toBe('finished');
    await waitFor(() => document.querySelector('[role="dialog"]') !== null);
    expect((await api?.run('ui.close'))?.status).toBe('finished');

    page.show('studio');
    await waitFor(() => present('editor-shell'));
    expect(host.mounted.getState()?.kind).toBe('studio');
    expect(app.operators.get('workspace.reset')).toBeDefined();
    expect(page.apps.length).toBe(1);
    await page.unmount();
    expect(window.__EKZA_STUDIO_TEST__).toBeUndefined();
  });

  it('opens the first-run dialog only when Studio’s shell mounts as the page’s first shell', async () => {
    const first = harness(false, true);
    first.show('studio');
    await waitFor(() => present('editor-shell'));
    await waitFor(() => first.host().app.session.getState().dialog === 'firstRun');
    await first.unmount();
    // AR-D8-6: a switch from the other (Auto-Rig) shell is a hand-over: no dialog over it
    const page = harness();
    page.show('other');
    await waitFor(() => present('other-shell'));
    const app = page.host().app;
    app.prefs.setState({ firstRunDone: false });
    await settle(50);
    expect(app.session.getState().dialog).toBeNull();
    page.show('studio');
    await waitFor(() => present('editor-shell'));
    await settle(50);
    expect(app.session.getState().dialog).toBeNull();
    await page.unmount();
  });

  it('boots one app under StrictMode, with no shell mounted between shells', async () => {
    const page = harness(true);
    page.show(null);
    await waitFor(() => present('editor-root'));
    expect(page.host().mounted.getState()).toBeNull();
    page.show('studio');
    await waitFor(() => present('editor-shell'));
    expect(page.apps.length).toBe(1);
    expect(page.host().mounted.getState()?.kind).toBe('studio');
    await page.unmount();
  });
});
