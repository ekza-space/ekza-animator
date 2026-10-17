// Mounting helpers for shell tests: a shell over the fake app, rendered at the e2e viewport size.
import type { DocSnapshot } from '@ekza-animator/doc';
import type { PrefsStorage } from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorAppProvider } from '../src/hooks';
import type { PanelRegistry } from '../src/panels/types';
import { createToastNotifier } from '../src/services/notify';
import { createMemoryStorage } from '../src/services/storage';
import { ShellProvider } from '../src/shell/context';
import { createShell } from '../src/shell/createShell';
import type { Summarizer } from '../src/shell/summary';
import type { Shell } from '../src/shell/types';
import { createSyntheticModelLoader } from '../src/testing/syntheticModels';
import { DEFAULT_PARAMS, type EditorParams } from '../src/test-api/params';
import { readSynthetic } from './render';

export interface TestShell {
  readonly app: FakeEditorApp;
  readonly shell: Shell;
  readonly storage: PrefsStorage & { removeItem(key: string): void };
  readonly toasts: ReturnType<typeof createToastNotifier>;
}

export async function waveFixtures(): Promise<{ snapshot: DocSnapshot; skeleton: SkeletonDesc }> {
  return {
    snapshot: (await readSynthetic('wave-doc.json')) as DocSnapshot,
    skeleton: (await readSynthetic('humanoid-skeleton.json')) as SkeletonDesc,
  };
}

export function createTestShell(
  opts: {
    readonly snapshot?: DocSnapshot;
    readonly skeleton?: SkeletonDesc;
    readonly storage?: PrefsStorage & { removeItem(key: string): void };
    readonly panels?: PanelRegistry;
    readonly params?: EditorParams;
    readonly summarize?: Summarizer;
    readonly platform?: 'mac' | 'other';
  } = {},
): TestShell {
  const toasts = createToastNotifier();
  const storage = opts.storage ?? createMemoryStorage();
  const app = createFakeEditorApp({
    ...(opts.snapshot === undefined ? {} : { snapshot: opts.snapshot }),
    ...(opts.skeleton === undefined ? {} : { skeleton: opts.skeleton }),
    ...(opts.platform === undefined ? {} : { platform: opts.platform }),
    // Like the editor's services: a model loader means the shell's GL host owns the ViewportManager (WP-5's panel
    // hosts its own canvas only for apps without one).
    services: { notify: toasts, storage, models: createSyntheticModelLoader() },
  });
  const shell = createShell({
    app,
    params: opts.params ?? DEFAULT_PARAMS,
    storage,
    toasts,
    helpMs: 60_000,
    ...(opts.panels === undefined ? {} : { panels: opts.panels }),
    ...(opts.summarize === undefined ? {} : { summarize: opts.summarize }),
  });
  return { app, shell, storage, toasts };
}

/** The shell's providers around `children`, in a 1440 × 900 box (the e2e viewport). */
export function ShellFrame(props: { readonly shell: Shell; readonly children?: ReactNode }): ReactNode {
  return (
    <ShellProvider shell={props.shell}>
      <EditorAppProvider app={props.shell.app}>
        <div style={{ position: 'relative', width: 1440, height: 900 }}>{props.children}</div>
      </EditorAppProvider>
    </ShellProvider>
  );
}

const inActEnvironment = (): boolean => globalThis.IS_REACT_ACT_ENVIRONMENT === true;

/** Waits `ms`, inside act when the test runs in an act environment (component tests), plainly otherwise. */
export async function settle(ms: number): Promise<void> {
  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, ms));
  if (inActEnvironment()) await act(wait);
  else await wait();
}

/** Polls `predicate` while React, timers and async operators settle. */
export async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await settle(10);
  }
}

/**
 * Mounts a whole editor without act(): the shell updates from timers, the R3F frame loop and async operators, which
 * act() cannot scope. Call `liveEnvironment()` in the file's beforeAll.
 */
export function mountLive(node: ReactNode): { readonly container: HTMLElement; unmount(): Promise<void> } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  root.render(node);
  return {
    container,
    async unmount() {
      root.unmount();
      container.remove();
      await settle(20);
    },
  };
}

/** Turns React's act environment off for the current test file (restores it in the returned function). */
export function liveEnvironment(): () => void {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  return () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  };
}
