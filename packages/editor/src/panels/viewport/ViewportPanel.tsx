// The viewport dock panel (MVP-SPEC §7 WP-5, ADR 0006 §2): its own pane grid (single, split, quad; resizable
// splitters; Space-maximized pane), pane headers, HUD and the empty-state drop zone. The 3D view is drawn by the
// shared canvas behind the workspace; panes register their surfaces with the app's ViewportManager.
// M2a (A2): the panel passes the Pointer Lock switch to the manager and runs the "FK limbs only" notice (§5.7).
import { type EditorApp, watchFkOnlyRigs } from '@ekza-animator/editor-core';
import { LAYOUT_PANES, type ViewportManager } from '@ekza-animator/viewport';
import { type JSX, useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useDocQuery, useSession } from '../../hooks';
import { useOptionalShell } from '../../shell/context';
import type { PanelProps } from '../types';
import { EmptyState } from './EmptyState';
import { useViewportManager } from './hooks';
import { PaneView } from './PaneView';
import { needsStandaloneHost, StandaloneHost } from './StandaloneHost';

export function ViewportPanel({ app }: PanelProps): JSX.Element {
  const vm = useViewportManager(app);
  const layout = useSession((s) => s.viewportLayout);
  const maximized = useSession((s) => s.maximizedPane);
  const empty = useDocQuery(hasNoCharacters, ['characters']);
  const panes = LAYOUT_PANES[layout] ?? LAYOUT_PANES.split;
  // M2a §5.18: the e2e switch `pointerLock=off` makes the viewport's virtual slider use pointer capture.
  const pointerLock = useOptionalShell()?.params.pointerLock ?? true;
  useEffect(() => vm?.setPointerLockAllowed(pointerLock), [vm, pointerLock]);
  // M2a §5.7: a humanoid rig with FK limbs only says once that Rig › Add Limb IK exists.
  useEffect(() => watchFkOnlyRigs(app), [app]);
  const shown = maximized !== null && panes.includes(maximized) ? [maximized] : panes;

  return (
    <div className="relative h-full w-full overflow-hidden" data-testid="viewport-panel" data-layout={layout}>
      {needsStandaloneHost(app) ? <StandaloneHost app={app} /> : null}
      <div className="absolute inset-0 flex">
        <PaneGrid app={app} vm={vm} panes={shown} />
      </div>
      {vm === null && !needsStandaloneHost(app) ? (
        <p className="pointer-events-none absolute bottom-2 left-2 text-[11px] text-fg-3">Starting the 3D view…</p>
      ) : null}
      {empty ? <EmptyState app={app} /> : null}
    </div>
  );
}

function hasNoCharacters(store: { list(table: 'characters'): readonly unknown[] }): boolean {
  return store.list('characters').length === 0;
}

function PaneGrid(props: {
  readonly app: EditorApp;
  readonly vm: ViewportManager | null;
  readonly panes: readonly string[];
}): JSX.Element {
  const { app, vm, panes } = props;
  const pane = (id: string): JSX.Element => <PaneView key={id} app={app} vm={vm} paneId={id} />;
  if (panes.length === 1) return <div className="flex min-w-0 flex-1">{pane(panes[0] as string)}</div>;
  if (panes.length === 2) {
    const [a, b] = panes as readonly [string, string];
    return (
      <Group orientation="horizontal" className="flex-1" id="ekza-viewport-split">
        <Panel id={`vp-${a}`} minSize="120px">
          {pane(a)}
        </Panel>
        <Splitter />
        <Panel id={`vp-${b}`} minSize="120px">
          {pane(b)}
        </Panel>
      </Group>
    );
  }
  const [tl, tr, bl, br] = panes as readonly [string, string, string, string];
  return (
    <Group orientation="vertical" className="flex-1" id="ekza-viewport-quad">
      <Panel id="vp-quad-top" minSize="90px">
        <Group orientation="horizontal" id="ekza-viewport-quad-top">
          <Panel id={`vp-${tl}`} minSize="120px">
            {pane(tl)}
          </Panel>
          <Splitter />
          <Panel id={`vp-${tr}`} minSize="120px">
            {pane(tr)}
          </Panel>
        </Group>
      </Panel>
      <Splitter vertical />
      <Panel id="vp-quad-bottom" minSize="90px">
        <Group orientation="horizontal" id="ekza-viewport-quad-bottom">
          <Panel id={`vp-${bl}`} minSize="120px">
            {pane(bl)}
          </Panel>
          <Splitter />
          <Panel id={`vp-${br}`} minSize="120px">
            {pane(br)}
          </Panel>
        </Group>
      </Panel>
    </Group>
  );
}

function Splitter(props: { readonly vertical?: boolean }): JSX.Element {
  return (
    <Separator
      className={`${props.vertical === true ? 'h-1' : 'w-1'} shrink-0 bg-[var(--bg-app,#1b1c1f)] transition-colors hover:bg-[var(--border-strong,#4b4e58)] data-[separator=active]:bg-accent`}
    />
  );
}
