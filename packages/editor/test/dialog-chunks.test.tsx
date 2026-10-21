// M2A-SPEC §5.21.2: dialogs are lazy chunks, and a chunk can fail to arrive (a network blip, offline after the page
// loaded, a redeploy that replaced the chunk hashes). A failed dialog closes with a toast and the editor keeps running;
// the next open loads the chunk again (React.lazy alone would keep the rejected load for the rest of the page). The
// chunk loaders are swapped through the test seam to fail without a network.
import type { DocSnapshot } from '@ekza-studio/doc';
import { GLOBAL_SCOPE } from '@ekza-studio/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-studio/editor-core/testing';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { type JSX, useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DialogHost, preloadDialog, setDialogLoaderForTests } from '../src/dialogs/DialogHost';
import { EditorRoot } from '../src/shell/EditorRoot';
import type { Shell } from '../src/shell/types';
import type { ModelSummary } from '../src/shell/summary';
import { createSyntheticModelLoader } from '../src/testing/syntheticModels';
import { DEFAULT_PARAMS } from '../src/test-api/params';
import {
  createTestShell,
  liveEnvironment,
  mountLive,
  settle,
  ShellFrame,
  waitFor,
  waveFixtures,
} from './shell-helpers';

let snapshot: DocSnapshot;
let skeleton: SkeletonDesc;
let style: HTMLStyleElement;
let restoreAct: () => void = () => {};
beforeAll(async () => {
  restoreAct = liveEnvironment();
  ({ snapshot, skeleton } = await waveFixtures());
  style = document.createElement('style');
  style.textContent =
    '.ekza-editor{position:relative;width:1440px;height:900px;display:block}' +
    '[data-testid="gl-host"]{position:fixed;inset:0;pointer-events:none}' +
    '[data-testid="editor-shell"]{display:flex;flex-direction:column;height:100%}' +
    '[data-testid="editor-shell"]>main{flex:1;min-height:0}';
  document.head.append(style);
});
afterAll(() => {
  style.remove();
  restoreAct();
});
afterEach(() => {
  for (const dialog of ['about', 'import', 'preferences', 'confirm'] as const) setDialogLoaderForTests(dialog, null);
});

const present = (id: string): boolean => document.querySelector(`[data-testid="${id}"]`) !== null;
const toastTexts = (): string[] =>
  [...document.querySelectorAll('[data-testid="toast"]')].map((toast) => (toast.textContent ?? '').trim());

/** A chunk module as the test seam takes it. */
type Module = { readonly default: unknown };

/** A loader that fails (like a chunk request that never arrived) until `recover()`, then loads `real`. */
function flakyLoader(real: () => Promise<Module>) {
  let failing = true;
  let calls = 0;
  return {
    load: (): Promise<Module> => {
      calls++;
      return failing ? Promise.reject(new Error('Failed to load chunk /_next/static/chunks/dialog.js')) : real();
    },
    recover: () => {
      failing = false;
    },
    calls: () => calls,
  };
}

const aboutModule = (): Promise<Module> =>
  import('../src/dialogs/AboutDialog').then((m) => ({ default: m.AboutDialog }));

async function mountEditor(): Promise<{ shell: Shell; app: FakeEditorApp; unmount: () => Promise<void> }> {
  let shell: Shell | null = null;
  let app: FakeEditorApp | null = null;
  const view = mountLive(
    <EditorRoot
      params={{ ...DEFAULT_PARAMS, e2e: true }}
      onShell={(mounted) => {
        shell = mounted;
        return undefined;
      }}
      createApp={({ services, platform }) => {
        app = createFakeEditorApp({
          snapshot,
          skeleton,
          services: { ...services, models: createSyntheticModelLoader() },
          platform,
        });
        return app;
      }}
    />,
  );
  await waitFor(() => shell !== null && present('editor-shell'));
  if (shell === null || app === null) throw new Error('the editor did not mount');
  return { shell, app, unmount: () => view.unmount() };
}

describe('a dialog chunk that fails to load', () => {
  it('closes the dialog with a toast, keeps the editor mounted, and loads on the next open', async () => {
    const about = flakyLoader(aboutModule);
    setDialogLoaderForTests('about', about.load);
    const { shell, app, unmount } = await mountEditor();

    await shell.runFromUi('ui.open', { dialog: 'about' });
    await waitFor(() => toastTexts().some((text) => text.includes("Couldn't load the About dialog")));
    expect(toastTexts()).toContain("Couldn't load the About dialog. Check the connection and try again.");
    await waitFor(() => app.session.getState().dialog === null);
    await settle(50);
    // The whole editor is still there: the chrome, the workspace and the GL host.
    for (const id of ['editor-root', 'editor-shell', 'menubar', 'workspace', 'gl-host']) expect(present(id)).toBe(true);
    expect(present('about-dialog')).toBe(false);

    // The next open loads the chunk again and shows the dialog (React.lazy alone would rethrow the first failure).
    about.recover();
    await shell.runFromUi('ui.open', { dialog: 'about' });
    await waitFor(() => present('about-dialog'));
    expect(about.calls()).toBe(2);
    await shell.runFromUi('ui.close');
    await unmount();
  });

  it('a failed intent prefetch is forgotten: the open that follows loads the chunk', async () => {
    const about = flakyLoader(aboutModule);
    setDialogLoaderForTests('about', about.load);
    const { shell, unmount } = await mountEditor();
    await expect(preloadDialog('about')).rejects.toThrow('could not be loaded');
    about.recover();
    await shell.runFromUi('ui.open', { dialog: 'about' });
    await waitFor(() => present('about-dialog'));
    expect(about.calls()).toBe(2);
    await shell.runFromUi('ui.close');
    await unmount();
  });

  it('a lazy component whose load failed while the dialog was closed is replaced at the next open', async () => {
    const gate: { release: (() => void) | null } = { release: null };
    let calls = 0;
    setDialogLoaderForTests('about', () => {
      calls++;
      if (calls > 1) return aboutModule();
      return new Promise<Module>((_resolve, reject) => {
        gate.release = () => reject(new Error('Failed to load chunk'));
      });
    });
    const { shell, app, unmount } = await mountEditor();
    await shell.runFromUi('ui.open', { dialog: 'about' });
    await waitFor(() => gate.release !== null);
    // Closed while its chunk is still on the way; the load then fails.
    await shell.runFromUi('ui.close');
    gate.release?.();
    await settle(50);
    expect(toastTexts().some((text) => text.includes('About dialog'))).toBe(false);
    await shell.runFromUi('ui.open', { dialog: 'about' });
    await waitFor(() => present('about-dialog'));
    expect(app.session.getState().dialog).toBe('about');
    expect(calls).toBe(2);
    await shell.runFromUi('ui.close');
    await unmount();
  });

  it('a dropped file whose Import dialog fails to load is dropped, not left waiting, and imports on a retry', async () => {
    const summary: ModelSummary = {
      format: 'gltf',
      formatLabel: 'glTF 2.0',
      byteLength: 16,
      meshes: 1,
      nodes: 3,
      skins: 1,
      clips: [],
      license: null,
      licenseLabel: 'No licence metadata',
      restricted: false,
      warnings: [],
    };
    const test = createTestShell({ summarize: async () => summary });
    const received: unknown[] = [];
    test.app.contribute({
      kind: 'operator',
      def: {
        id: 'file.importModel',
        label: 'Import',
        category: 'file',
        scope: GLOBAL_SCOPE,
        apply: (_c, a) => received.push(a),
      },
    });
    test.app.contribute({
      kind: 'importer',
      def: { id: 'gltf-model', label: 'Model', extensions: ['glb', 'vrm'], op: 'file.importModel' },
    });
    const flaky = flakyLoader(() => import('../src/dialogs/ImportDialog').then((m) => ({ default: m.ImportDialog })));
    setDialogLoaderForTests('import', flaky.load);
    const view = mountLive(
      <ShellFrame shell={test.shell}>
        <div data-testid="marker" />
        <DialogHost />
      </ShellFrame>,
    );
    await test.shell.files.openFile('polybot.vrm', new Uint8Array(16), { waitForDialog: true });
    expect(test.toasts.store.getState().toasts.map((toast) => toast.text)).toContain(
      "Couldn't load the Import dialog. Check the connection and try again.",
    );
    expect(test.app.session.getState().dialog).toBeNull();
    expect(test.shell.ui.getState().pendingImport).toBeNull();
    expect(present('marker')).toBe(true);
    expect(received).toEqual([]);

    flaky.recover();
    const second = test.shell.files.openFile('polybot.vrm', new Uint8Array(16), { waitForDialog: true });
    await waitFor(() => present('import-confirm'));
    (document.querySelector('[data-testid="import-confirm"]') as HTMLButtonElement).click();
    await second;
    await waitFor(() => received.length === 1);
    await view.unmount();
  });

  it('the confirm prompt answers Cancel when its chunk fails, and prompts on the next request', async () => {
    const test = createTestShell(); // not e2e: shell.confirm shows the prompt
    const flaky = flakyLoader(() => import('../src/dialogs/ConfirmDialog').then((m) => ({ default: m.ConfirmDialog })));
    setDialogLoaderForTests('confirm', flaky.load);
    const view = mountLive(
      <ShellFrame shell={test.shell}>
        <div data-testid="marker" />
        <DialogHost />
      </ShellFrame>,
    );
    const request = { title: 'New project', text: 'Discard?', confirmLabel: 'Discard' };
    expect(await test.shell.confirm(request)).toBe(false);
    expect(test.toasts.store.getState().toasts.map((toast) => toast.text)).toContain(
      "Couldn't load the confirmation prompt. Check the connection and try again.",
    );
    expect(test.shell.ui.getState().confirm).toBeNull();
    expect(present('marker')).toBe(true);

    flaky.recover();
    const answer = test.shell.confirm(request);
    await waitFor(() => present('confirm-ok'));
    (document.querySelector('[data-testid="confirm-ok"]') as HTMLButtonElement).click();
    expect(await answer).toBe(true);
    await view.unmount();
  });

  it('a dialog that throws as it renders closes with its error and leaves the editor running', async () => {
    function Broken(): never {
      throw new Error('broken on purpose');
    }
    setDialogLoaderForTests('preferences', () => Promise.resolve({ default: Broken }));
    const test = createTestShell();
    const view = mountLive(
      <ShellFrame shell={test.shell}>
        <Counter />
        <DialogHost />
      </ShellFrame>,
    );
    await test.shell.runFromUi('ui.open', { dialog: 'preferences' });
    expect(test.app.session.getState().dialog).toBe('preferences');
    await waitFor(() => test.app.session.getState().dialog === null);
    expect(test.toasts.store.getState().toasts.map((toast) => toast.text)).toContain(
      'The Preferences dialog failed: broken on purpose',
    );
    // State elsewhere in the tree survived (the root did not unmount and remount).
    (document.querySelector('[data-testid="counter"]') as HTMLButtonElement).click();
    await waitFor(() => document.querySelector('[data-testid="counter"]')?.textContent === '1');
    await view.unmount();
  });
});

function Counter(): JSX.Element {
  const [count, setCount] = useState(0);
  return (
    <button type="button" data-testid="counter" onClick={() => setCount((n) => n + 1)}>
      {count}
    </button>
  );
}
