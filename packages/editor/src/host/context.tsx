// The HostShell's React context (AUTORIG-SPEC §4.4, D1): `StudioHost` provides it to everything on the page — the GL
// host, the dialog host, the toaster, the shells and their panels. The Studio shell's `ShellProvider` provides it too
// (a Shell is a HostShell), so components mounted under a bare ShellProvider (unit tests) see the host as well.
import { EkzaError } from '@ekza-studio/anim-core';
import { createContext, type JSX, type ReactNode, useContext } from 'react';
import { useStoreSelector } from '../hooks/useStoreSelector';
import type { ShellUiState } from '../shell/types';
import type { HostShell } from './types';

export const HostContext = createContext<HostShell | null>(null);

export function HostProvider(props: { readonly host: HostShell; readonly children?: ReactNode }): JSX.Element {
  return <HostContext value={props.host}>{props.children}</HostContext>;
}

/** The host around a component, or null (panels rendered by a bare EditorAppProvider, e.g. in unit tests). */
export function useOptionalHost(): HostShell | null {
  return useContext(HostContext);
}

export function useHost(): HostShell {
  const host = useContext(HostContext);
  if (host === null) throw new EkzaError('internal', 'useHost() must be called inside <StudioHost>');
  return host;
}

/** Selected host UI state; re-renders only when the selection changes under `equality`. */
export function useHostUi<T>(selector: (state: ShellUiState) => T, equality?: (a: T, b: T) => boolean): T {
  return useStoreSelector(useHost().ui, selector, equality);
}
