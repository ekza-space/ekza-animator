// What every part of the Halo shell reaches (STUDIO-TOUCH-SPEC §20.2): the page's host and app, the shell's store, its
// toasts and one way to run an operator for a surface. Provided to the React tree by `HaloShell`.
import type { EditorApp, OperatorResult } from '@ekza-studio/editor-core';
import type { HostShell } from '@ekza-studio/editor/host';
import type { ToastStore } from '@ekza-studio/ui/touch';
import type { ViewportManager } from '@ekza-studio/viewport';
import { createContext, useContext } from 'react';
import type { HaloStore } from './store';

export interface ShellContext {
  readonly host: HostShell;
  readonly app: EditorApp;
  readonly store: HaloStore;
  readonly toasts: ToastStore;
  /** The page's viewport manager (null until the GL host made it). */
  vm(): ViewportManager | null;
  /** Runs an operator for a Halo surface (the host's `runFromUi`, from the single pane). */
  run(op: string, args?: unknown): Promise<OperatorResult<unknown>>;
}

export const HaloContext = createContext<ShellContext | null>(null);

export function useShell(): ShellContext {
  const ctx = useContext(HaloContext);
  if (ctx === null) throw new Error('Halo: useShell outside HaloShell');
  return ctx;
}
