import { EkzaError } from '@ekza-studio/anim-core';
import { createContext, type JSX, type ReactNode, useContext } from 'react';
import { HostContext } from '../host/context';
import { useStoreSelector } from '../hooks/useStoreSelector';
import type { Shell, ShellUiState } from './types';

/** The Studio shell (AUTORIG-SPEC §4.4). The host's dialog layer provides the mounted Studio shell here as well. */
export const ShellContext = createContext<Shell | null>(null);

/** Provides the Studio shell and, since a Shell is a HostShell, the host context with it. */
export function ShellProvider(props: { readonly shell: Shell; readonly children?: ReactNode }): JSX.Element {
  return (
    <HostContext value={props.shell}>
      <ShellContext value={props.shell}>{props.children}</ShellContext>
    </HostContext>
  );
}

/**
 * The Studio shell around a component; outside it (a pane of the Auto-Rig shell on `/autorig`) the HostShell; null
 * without either (panels rendered by a bare EditorAppProvider, e.g. in unit tests). Callers outside Studio — the
 * panel hooks and `PaneView` — read only HostShell members; the Studio-only panels (Graph Editor, Dope Sheet) render
 * under the Studio shell, whose `workspace` they read.
 */
export function useOptionalShell(): Shell | null {
  const shell = useContext(ShellContext);
  const host = useContext(HostContext);
  return shell ?? (host as Shell | null);
}

/**
 * The Studio shell. Outside it — a host-mounted dialog on a route without the Studio shell (`/autorig`) — the HostShell
 * answers: those dialogs read only HostShell members (`app`, `runFromUi`, `confirm`, `files`, `help`, `ui`, `params`);
 * the Studio-only dialogs (Layout presets) open from Studio's menus only.
 */
export function useShell(): Shell {
  const shell = useContext(ShellContext);
  const host = useContext(HostContext);
  if (shell !== null) return shell;
  if (host === null) throw new EkzaError('internal', 'useShell() must be called inside <ShellProvider>');
  return host as Shell;
}

/** Selected shell UI state; re-renders only when the selection changes under `equality`. */
export function useShellUi<T>(selector: (state: ShellUiState) => T, equality?: (a: T, b: T) => boolean): T {
  return useStoreSelector(useShell().ui, selector, equality);
}
