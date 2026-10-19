// The command palette in the shell (M6A-SPEC §5.18; B9): an eager facade over the lazy controller and list UI.
// `Mod+K` (`ui.commandPalette`) loads both on first use and opens the palette; the facade owns the state store the
// host and the test API read.
import { type JSX, lazy, Suspense } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStoreSelector } from '../../hooks/useStoreSelector';
import type { CommandPaletteController, CommandPaletteDeps } from './controller';
import type { PaletteEntry, PaletteState } from './types';

export type { PaletteEntry, PalettePrompt, PaletteState } from './types';

export interface CommandPalette {
  readonly state: StoreApi<PaletteState>;
  /** The controller once loaded, else null. */
  controller(): CommandPaletteController | null;
  load(): Promise<CommandPaletteController>;
  /** Opens the palette (after the first load). */
  open(): void;
  close(): void;
  /** The filtered entries of the open palette (none before it has loaded). */
  items(): readonly PaletteEntry[];
}

const CLOSED: PaletteState = { open: false, query: '', index: 0, entries: [], prompt: null };

export function createCommandPalette(deps: Omit<CommandPaletteDeps, 'state'>): CommandPalette {
  const state = createStore<PaletteState>()(() => CLOSED);
  let controller: CommandPaletteController | null = null;
  let loading: Promise<CommandPaletteController> | null = null;
  const load = (): Promise<CommandPaletteController> => {
    loading ??= import('./controller').then(
      ({ createCommandPaletteController }) => {
        controller ??= createCommandPaletteController({ ...deps, state });
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
      if (controller !== null) controller.open();
      else void load().then((loaded) => loaded.open());
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
