// The command palette in the shell (M6A-SPEC §5.18; B9): an eager facade over the lazy controller and list UI.
// `Mod+K` (`ui.commandPalette`) loads both on first use and opens the palette; the facade owns the state store the
// host and the test API read. A load that fails (offline after a redeploy) says so on the help line; the next
// `Mod+K` tries again.
import { type JSX, lazy, Suspense } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStoreSelector } from '../../hooks/useStoreSelector';
import type * as ControllerModule from './controller';
import type { CommandPaletteController, CommandPaletteDeps } from './controller';
import type * as ViewModule from './CommandPaletteView';
import type { PaletteEntry, PaletteState } from './types';

export type { PaletteEntry, PalettePrompt, PaletteState } from './types';

/** The help-line message of a failed load. */
export const PALETTE_LOAD_FAILED = 'The command palette could not be loaded. Check the connection, then try again.';

/** The palette's lazy chunks: the controller and the list UI (loaded together, so the UI never fails on its own). */
export interface PaletteChunks {
  readonly controller: typeof ControllerModule;
  readonly view: typeof ViewModule;
}

const importChunks = (): Promise<PaletteChunks> =>
  Promise.all([import('./controller'), import('./CommandPaletteView')]).then(([controller, view]) => ({
    controller,
    view,
  }));

export interface CommandPaletteFacadeDeps extends Omit<CommandPaletteDeps, 'state'> {
  /** Tells the user that the palette could not be loaded (the shell's help line). */
  readonly help?: (text: string, tone?: 'info' | 'warning' | 'error') => void;
  /** Loads the lazy chunks; replaceable for tests. */
  readonly importChunks?: () => Promise<PaletteChunks>;
}

export interface CommandPalette {
  readonly state: StoreApi<PaletteState>;
  /** The controller once loaded, else null. */
  controller(): CommandPaletteController | null;
  load(): Promise<CommandPaletteController>;
  /** Opens the palette (after the first load; a failed load is reported, not thrown). */
  open(): void;
  close(): void;
  /** The filtered entries of the open palette (none before it has loaded). */
  items(): readonly PaletteEntry[];
}

const CLOSED: PaletteState = { open: false, query: '', index: 0, entries: [], prompt: null };

export function createCommandPalette(deps: CommandPaletteFacadeDeps): CommandPalette {
  const { help, importChunks: importer = importChunks, ...controllerDeps } = deps;
  const state = createStore<PaletteState>()(() => CLOSED);
  let controller: CommandPaletteController | null = null;
  let loading: Promise<CommandPaletteController> | null = null;
  const load = (): Promise<CommandPaletteController> => {
    loading ??= importer().then(
      (chunks) => {
        controller ??= chunks.controller.createCommandPaletteController({ ...controllerDeps, state });
        return controller;
      },
      (error: unknown) => {
        loading = null;
        throw error;
      },
    );
    return loading;
  };
  return {
    state,
    controller: () => controller,
    load,
    open() {
      if (controller !== null) {
        controller.open();
        return;
      }
      void load().then(
        (loaded) => loaded.open(),
        (error: unknown) => {
          console.warn('Ekza Animator: the command palette could not be loaded', error);
          help?.(PALETTE_LOAD_FAILED, 'error');
        },
      );
    },
    close() {
      controller?.close();
    },
    items: () => controller?.items() ?? [],
  };
}

const CommandPaletteView = lazy(() => import('./CommandPaletteView'));

export function CommandPaletteHost(props: { readonly palette: CommandPalette }): JSX.Element | null {
  const open = useStoreSelector(props.palette.state, (s) => s.open);
  const controller = props.palette.controller();
  if (!open || controller === null) return null;
  return (
    <Suspense fallback={null}>
      <CommandPaletteView controller={controller} />
    </Suspense>
  );
}
