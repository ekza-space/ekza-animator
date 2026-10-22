// The wizard's React context and hooks (AUTORIG-SPEC §4.1, §5.1; D3): what the frame gives every step view — the
// host (`@ekza-studio/editor/host`), its EditorApp, the session store, the derived progress, navigation between the
// steps and the footer the step fills (status line and one primary button). No document writes here: steps run
// operators (`host.runFromUi`), never the store.
import type { EditorApp } from '@ekza-studio/editor-core';
import type { HostShell } from '@ekza-studio/editor/host';
import { createContext, type ReactNode, useCallback, useContext, useSyncExternalStore } from 'react';
import type { AutoRigSessionStore } from '../session';
import type { AutoRigProgress, AutoRigSession, AutoRigStep, AutoRigSubject } from '../types';
import type { SmallStore } from './store';

/** The shell's own U state besides the session. */
export interface ShellUi {
  /** A Studio hand-over waiting for ①'s "Use these" (§3.4, §5.2). */
  readonly fromStudio: AutoRigSubject | null;
  /** A requested step waiting for its document (a reload, `?step=`, a handoff record): taken once reachable. */
  readonly pendingStep: AutoRigStep | null;
}

/** The footer a step shows (§5.1: Back, one status line, one primary button). */
export interface FooterState {
  readonly status?: ReactNode;
  readonly tone?: 'info' | 'warning' | 'error';
  readonly primary?: {
    readonly label: string;
    readonly run: () => void | Promise<void>;
    readonly disabled?: boolean;
  } | null;
}

export interface WizardContext {
  readonly host: HostShell;
  readonly app: EditorApp;
  readonly session: AutoRigSessionStore;
  /** Goes to a reachable step (entry order of §4.2); unreachable steps are refused. Never undoes anything. */
  go(step: AutoRigStep): void;
  /** The footer of the current step (the step view sets it while mounted). */
  setFooter(footer: FooterState): void;
  /** The current progress (derived; the same object until an input changes). */
  progress(): AutoRigProgress;
  /** Progress as a store (document, session and rig-chunk changes notify). */
  readonly progressStore: { subscribe(listener: () => void): () => void; get(): AutoRigProgress };
  /** The shell's own U state (the From Studio hand-over, the pending step). */
  readonly ui: SmallStore<ShellUi>;
  /** Runs an operator for the wizard's UI (failures toast and show in the footer); resolves with its result. */
  run(op: string, args?: unknown): ReturnType<HostShell['runFromUi']>;
  /** Files dropped or chosen anywhere in the wizard (① takes them; ④ may register its own). */
  readonly files: { handle(files: readonly File[]): void };
}

export const Wizard = createContext<WizardContext | null>(null);

export function useWizard(): WizardContext {
  const ctx = useContext(Wizard);
  if (ctx === null) throw new Error('useWizard() must be called inside the Auto-Rig shell');
  return ctx;
}

/** A selection of the session; re-renders when it changes (`Object.is`). */
export function useSession<T>(store: AutoRigSessionStore, select: (session: AutoRigSession) => T): T {
  const get = useCallback(() => select(store.getState()), [store, select]);
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  return useSyncExternalStore(subscribe, get, get);
}

/** The derived progress; re-renders when it changes. */
export function useProgress(ctx: Pick<WizardContext, 'progressStore'>): AutoRigProgress {
  const { progressStore } = ctx;
  const subscribe = useCallback((listener: () => void) => progressStore.subscribe(listener), [progressStore]);
  const get = useCallback(() => progressStore.get(), [progressStore]);
  return useSyncExternalStore(subscribe, get, get);
}

/** A value derived from the document (re-read on every committed batch and on load). */
export function useDocument<T>(app: EditorApp, read: () => T): T {
  const subscribe = useCallback((notify: () => void) => app.store.subscribe(() => notify()), [app]);
  const get = useCallback(() => app.store.version, [app]);
  useSyncExternalStore(subscribe, get, get);
  return read();
}

/** A selection of the app's session (U state: busy, recovery, workspace…). */
export function useAppSession<T>(
  app: EditorApp,
  select: (state: ReturnType<EditorApp['session']['getState']>) => T,
): T {
  const get = useCallback(() => select(app.session.getState()), [app, select]);
  return useSyncExternalStore(app.session.subscribe, get, get);
}
