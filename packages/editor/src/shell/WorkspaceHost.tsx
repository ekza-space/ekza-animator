// WorkspaceHost (ARCHITECTURE §10): the dockview adapter. Registered panels render through their PanelDef; Animate
// slots without a registered panel render a placeholder until the owning work package lands.
import type { Disposer } from '@ekza-animator/anim-core';
import { PANEL, type PanelKind } from '@ekza-animator/editor-core';
import {
  DockviewDefaultTab,
  type DockviewReadyEvent,
  DockviewReact,
  type DockviewTheme,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from 'dockview-react';
import { type FunctionComponent, type JSX, useCallback, useEffect, useMemo, useRef } from 'react';
import { useShell } from './context';
import { FIXED_KINDS, type PanelParams, PLACEHOLDER_COMPONENT } from './layout';
import { PlaceholderPanel, RegisteredPanel } from './PanelFrame';
import type { Shell } from './types';

export const EKZA_DOCKVIEW_THEME: DockviewTheme = {
  name: 'ekza',
  className: 'dockview-theme-ekza',
  colorScheme: 'dark',
  gap: 0,
  dndOverlayMounting: 'absolute',
  dndPanelOverlay: 'group',
};

type PanelComponent = FunctionComponent<IDockviewPanelProps<PanelParams>>;

function buildComponents(shell: Shell): Record<string, PanelComponent> {
  const components: Record<string, PanelComponent> = {};
  for (const def of shell.panels.list()) {
    if (FIXED_KINDS.has(def.kind)) continue;
    const Registered: PanelComponent = (props) => (
      <RegisteredPanel def={def} app={shell.app} instanceId={props.api.id} />
    );
    Registered.displayName = `Panel(${def.id})`;
    components[def.id] = Registered;
  }
  const Placeholder: PanelComponent = (props) => (
    <PlaceholderPanel
      kind={typeof props.params.kind === 'string' ? props.params.kind : 'unknown'}
      title={props.api.title ?? 'Panel'}
      instanceId={props.api.id}
    />
  );
  components[PLACEHOLDER_COMPONENT] = Placeholder;
  return components;
}

/** Tabs: the viewport cannot be closed (it is the workspace's centre); other panels re-open from Windows. */
function Tab(props: IDockviewPanelHeaderProps<PanelParams>): JSX.Element {
  const kind: PanelKind | undefined = props.params.kind;
  return <DockviewDefaultTab {...props} hideClose={kind === PANEL.viewport} />;
}

export function WorkspaceHost(): JSX.Element {
  const shell = useShell();
  const components = useMemo(() => buildComponents(shell), [shell]);
  const detach = useRef<Disposer | null>(null);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      detach.current?.();
      detach.current = shell.attachWorkspace(event.api);
    },
    [shell],
  );

  useEffect(
    () => () => {
      detach.current?.();
      detach.current = null;
    },
    [],
  );

  return (
    <div className="relative h-full min-h-0 w-full min-w-0" data-testid="workspace">
      <DockviewReact
        theme={EKZA_DOCKVIEW_THEME}
        components={components}
        defaultTabComponent={Tab}
        onReady={onReady}
        disableFloatingGroups
        singleTabMode="default"
      />
    </div>
  );
}
