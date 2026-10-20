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

/** A group whose body is shorter than this is collapsed to its tab bar (Model's Mesh Check dock, §8.2). */
const COLLAPSED_BODY_PX = 40;
/** The body height a click on a collapsed group's tab opens it to. */
export const EXPANDED_BODY_PX = 220;

/**
 * Tabs: the viewport cannot be closed (it is the workspace's centre); other panels re-open from Windows. A click on
 * the tab of a group collapsed to its tab bar (Model's Mesh Check dock) opens the group to a usable height
 * (acceptance fix round 1: the panel was docked with zero height until the sash was dragged).
 */
function Tab(props: IDockviewPanelHeaderProps<PanelParams>): JSX.Element {
  const kind: PanelKind | undefined = props.params.kind;
  const api = props.api;
  const onClick = useCallback(() => {
    if (api.height < COLLAPSED_BODY_PX) api.group.api.setSize({ height: api.group.api.height + EXPANDED_BODY_PX });
  }, [api]);
  return <DockviewDefaultTab {...props} onClick={onClick} hideClose={kind === PANEL.viewport} />;
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
