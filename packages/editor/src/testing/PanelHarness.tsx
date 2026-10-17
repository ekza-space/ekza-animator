// Panel harness behind the dev/e2e-only route /dev/panels?panel=<id> (MVP-SPEC §7 WP-0b, then WP-8): mounts one
// registered panel full-page with a fake EditorApp (@ekza-animator/editor-core/testing) inside the shell's context
// (shell hooks, frame callbacks, probes; the GL host for the viewport panel), so panel owners can work on a panel
// before the real kernel exists. Browser and Vitest browser mode only.
import { EkzaError } from '@ekza-animator/anim-core';
import type { DocSnapshot } from '@ekza-animator/doc';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { PANEL } from '@ekza-animator/editor-core';
import { type JSX, useEffect, useState } from 'react';
import { GLHost } from '../gl/GLHost';
import { EditorAppProvider } from '../hooks';
import { registerBuiltinPanels } from '../panels';
import { createPanelRegistry } from '../panels/registry';
import type { PanelDef, PanelRegistry } from '../panels/types';
import { ShellProvider } from '../shell/context';
import { createShell } from '../shell/createShell';
import { RegisteredPanel } from '../shell/PanelFrame';
import type { Shell } from '../shell/types';
import { DEFAULT_PARAMS } from '../test-api/params';
import { DEV_STATE_PANEL } from './DevStatePanel';

declare global {
  interface Window {
    /** Set while a harness is mounted: e2e specs inspect the fake app (e.g. `app.calls`). */
    __EKZA_DEV_PANELS__?: { readonly app: FakeEditorApp; readonly panels: PanelRegistry };
  }
}

export interface PanelHarnessProps {
  /** A DocSnapshot, e.g. fixtures/synthetic/wave-doc.json (JSON data, checked at runtime). */
  readonly snapshot: unknown;
  /** A SkeletonDesc shared by every character, e.g. fixtures/synthetic/humanoid-skeleton.json; null: no runtimes. */
  readonly skeleton: unknown;
  /** Panel to mount; null shows the index; omitted reads `?panel=` from the page URL. */
  readonly panel?: string | null;
  readonly platform?: 'mac' | 'other';
}

interface Harness {
  readonly app: FakeEditorApp;
  readonly panels: PanelRegistry;
  readonly shell: Shell;
}

/** Built-in panels plus the harness's `dev.state` panel. The props are read once, when the harness mounts. */
export function PanelHarness(props: PanelHarnessProps): JSX.Element {
  // The fake app only subscribes to its own stores, so an instance StrictMode discards needs no disposal.
  const [harness] = useState(() => createHarness(props));
  const panelId = props.panel === undefined ? new URLSearchParams(window.location.search).get('panel') : props.panel;

  useEffect(() => {
    const exposed = { app: harness.app, panels: harness.panels };
    window.__EKZA_DEV_PANELS__ = exposed;
    return () => {
      if (window.__EKZA_DEV_PANELS__ === exposed) delete window.__EKZA_DEV_PANELS__;
    };
  }, [harness]);

  const def = panelId === null ? undefined : harness.panels.get(panelId);
  if (def === undefined) return <PanelIndex panels={harness.panels.list()} unknown={panelId} />;
  const viewport = def.kind === PANEL.viewport;
  return (
    <ShellProvider shell={harness.shell}>
      <EditorAppProvider app={harness.app}>
        {viewport ? <GLHost /> : null}
        <div className="relative flex h-dvh flex-col text-fg" data-testid="dev-panels">
          <header className="flex items-center gap-3 border-b border-line bg-header px-3 py-1 text-xs text-fg-2">
            {/* oxlint-disable-next-line nextjs/no-html-link-for-pages -- the editor package does not depend on Next.js. */}
            <a className="text-accent-text" href="?" data-testid="dev-panels-home">
              Panels
            </a>
            <span data-testid="dev-panels-title">{def.title}</span>
            <span className="text-fg-3">
              {def.id} · kind {def.kind} · scope {def.keyScope}
            </span>
          </header>
          <main className={`relative min-h-0 flex-1 ${viewport ? '' : 'bg-panel'}`} data-testid={`dev-panel-${def.id}`}>
            <RegisteredPanel def={def} app={harness.app} instanceId={`${def.id}#1`} />
          </main>
        </div>
      </EditorAppProvider>
    </ShellProvider>
  );
}

function PanelIndex(props: { readonly panels: readonly PanelDef[]; readonly unknown: string | null }): JSX.Element {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8 text-sm" data-testid="dev-panels-index">
      <h1 className="text-xl font-semibold">Panel harness</h1>
      {props.unknown === null ? null : (
        <p className="text-fg-2" data-testid="dev-panels-unknown">
          No panel is registered as '{props.unknown}'.
        </p>
      )}
      <p className="text-fg-2">
        Each panel mounts alone with a fake EditorApp over the synthetic wave document. Panels register in
        packages/editor/src/panels/index.ts.
      </p>
      <ul className="flex flex-col gap-1">
        {props.panels.map((panel) => (
          <li key={panel.id}>
            <a
              className="text-accent-text underline-offset-4 hover:underline"
              href={`?panel=${encodeURIComponent(panel.id)}`}
              data-testid={`dev-panels-link-${panel.id}`}
            >
              {panel.title}
            </a>{' '}
            <span className="font-mono text-fg-3">{panel.id}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

function createHarness(props: PanelHarnessProps): Harness {
  const app = createFakeEditorApp({
    snapshot: asSnapshot(props.snapshot),
    ...(props.skeleton === null ? {} : { skeleton: asSkeleton(props.skeleton) }),
    ...(props.platform === undefined ? {} : { platform: props.platform }),
  });
  const panels = createPanelRegistry();
  registerBuiltinPanels(panels);
  panels.register(DEV_STATE_PANEL);
  const shell = createShell({ app, params: DEFAULT_PARAMS, storage: null, panels });
  return { app, panels, shell };
}

function asSnapshot(value: unknown): DocSnapshot {
  const candidate = value as Partial<DocSnapshot> | null;
  if (candidate?.format !== 'ekza-animator-doc' || typeof candidate.tables !== 'object') {
    throw new EkzaError('invalid-record', 'PanelHarness: `snapshot` is not an ekza-animator-doc snapshot');
  }
  return value as DocSnapshot;
}

function asSkeleton(value: unknown): SkeletonDesc {
  const candidate = value as Partial<SkeletonDesc> | null;
  if (!Array.isArray(candidate?.nodes) || !Array.isArray(candidate.facing)) {
    throw new EkzaError('invalid-record', 'PanelHarness: `skeleton` is not a SkeletonDesc');
  }
  return value as SkeletonDesc;
}
