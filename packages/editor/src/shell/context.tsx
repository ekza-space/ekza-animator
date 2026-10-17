import { EkzaError } from '@ekza-animator/anim-core';
import { createContext, type JSX, type ReactNode, useContext } from 'react';
import { useStoreSelector } from '../hooks/useStoreSelector';
import type { Shell, ShellUiState } from './types';

const ShellContext = createContext<Shell | null>(null);

export function ShellProvider(props: { readonly shell: Shell; readonly children?: ReactNode }): JSX.Element {
  return <ShellContext value={props.shell}>{props.children}</ShellContext>;
}

/** The shell around a component, or null (panels rendered by a bare EditorAppProvider, e.g. in unit tests). */
export function useOptionalShell(): Shell | null {
  return useContext(ShellContext);
}

export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (shell === null) throw new EkzaError('internal', 'useShell() must be called inside <ShellProvider>');
  return shell;
}

/** Selected shell UI state; re-renders only when the selection changes under `equality`. */
export function useShellUi<T>(selector: (state: ShellUiState) => T, equality?: (a: T, b: T) => boolean): T {
  return useStoreSelector(useShell().ui, selector, equality);
}
