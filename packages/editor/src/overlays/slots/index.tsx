// Overlay slots (M6A-SPEC §4.8, §8.7, §8.8; B9 creates them, the owners fill them): each viewport pane has fixed
// places for the Poly Count HUD (top-left, B10), the Last-op card (bottom-left, B11), the modal readout (at the
// pointer, B12a), the `BIND POSE` badge (bottom-right, B10), the Model empty state (centre, B13) and the Getting
// started card (top-right, B13); the shell has one for the option box popover (B11). Owners register a component per
// slot with `registerPaneOverlay(slot, Component)` (the latest registration of a slot is drawn) and decide themselves
// in which workspaces and modes they show. Slot wrappers never take the pointer: interactive overlays set
// `pointer-events: auto` on their own elements.
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp } from '@ekza-animator/editor-core';
import type { PaneState } from '@ekza-animator/viewport';
import { type ComponentType, type JSX, useSyncExternalStore } from 'react';

/** The pane overlay slots, in drawing order (later ones on top). */
export const PANE_OVERLAY_SLOTS = [
  'hud',
  'bindPose',
  'emptyState',
  'gettingStarted',
  'lastOpCard',
  'modalReadout',
] as const;
export type PaneOverlaySlot = (typeof PANE_OVERLAY_SLOTS)[number];

/** Shell-level overlay slots (outside the panes). */
export const SHELL_OVERLAY_SLOTS = ['optionBox'] as const;
export type ShellOverlaySlot = (typeof SHELL_OVERLAY_SLOTS)[number];

export interface PaneOverlayProps {
  readonly app: EditorApp;
  readonly paneId: string;
  /** The pane's camera and display (null before the viewport is ready). */
  readonly state: PaneState | null;
}

export interface ShellOverlayProps {
  readonly app: EditorApp;
}

/** Where each pane slot sits (Tailwind classes on the slot wrapper). */
const PLACEMENT: Readonly<Record<PaneOverlaySlot, string>> = {
  hud: 'absolute left-2 top-6',
  bindPose: 'absolute bottom-6 right-2',
  emptyState: 'absolute inset-0 grid place-items-center',
  gettingStarted: 'absolute right-2 top-1.5',
  lastOpCard: 'absolute bottom-2 left-2',
  modalReadout: 'absolute inset-0',
};

interface Registry<S extends string, P> {
  readonly entries: Map<S, readonly { readonly component: ComponentType<P>; readonly token: object }[]>;
  readonly listeners: Set<() => void>;
  version: number;
}

function createSlotRegistry<S extends string, P>(): Registry<S, P> {
  return { entries: new Map(), listeners: new Set(), version: 0 };
}

const pane = createSlotRegistry<PaneOverlaySlot, PaneOverlayProps>();
const shell = createSlotRegistry<ShellOverlaySlot, ShellOverlayProps>();

function register<S extends string, P>(registry: Registry<S, P>, slot: S, component: ComponentType<P>): Disposer {
  const token = {};
  registry.entries.set(slot, [...(registry.entries.get(slot) ?? []), { component, token }]);
  const notify = (): void => {
    registry.version += 1;
    for (const listener of registry.listeners) listener();
  };
  notify();
  return () => {
    const list = registry.entries.get(slot) ?? [];
    const next = list.filter((entry) => entry.token !== token);
    if (next.length === list.length) return;
    if (next.length === 0) registry.entries.delete(slot);
    else registry.entries.set(slot, next);
    notify();
  };
}

function current<S extends string, P>(registry: Registry<S, P>, slot: S): ComponentType<P> | null {
  return registry.entries.get(slot)?.at(-1)?.component ?? null;
}

function useRegistry<S extends string, P>(registry: Registry<S, P>): number {
  return useSyncExternalStore(
    (listener) => {
      registry.listeners.add(listener);
      return () => registry.listeners.delete(listener);
    },
    () => registry.version,
    () => registry.version,
  );
}

/** Registers the component drawn in a pane slot of every viewport pane; the disposer removes it. */
export function registerPaneOverlay(slot: PaneOverlaySlot, component: ComponentType<PaneOverlayProps>): Disposer {
  return register(pane, slot, component);
}

/** Registers the component drawn in a shell overlay slot (B11's option box popover). */
export function registerShellOverlay(slot: ShellOverlaySlot, component: ComponentType<ShellOverlayProps>): Disposer {
  return register(shell, slot, component);
}

/** The component registered in a pane slot (the latest), or null. */
export function paneOverlay(slot: PaneOverlaySlot): ComponentType<PaneOverlayProps> | null {
  return current(pane, slot);
}

/** The pane slots with their registered components, drawn over a pane's surface. */
export function PaneOverlays(props: PaneOverlayProps): JSX.Element {
  useRegistry(pane);
  return (
    <>
      {PANE_OVERLAY_SLOTS.map((slot) => {
        const Component = current(pane, slot);
        if (Component === null) return null;
        return (
          <div
            key={slot}
            className={`pointer-events-none z-20 ${PLACEMENT[slot]}`}
            data-testid={`pane-slot-${slot}-${props.paneId}`}
          >
            <Component app={props.app} paneId={props.paneId} state={props.state} />
          </div>
        );
      })}
    </>
  );
}

/** The shell overlay slots with their registered components. */
export function ShellOverlays(props: ShellOverlayProps): JSX.Element {
  useRegistry(shell);
  return (
    <>
      {SHELL_OVERLAY_SLOTS.map((slot) => {
        const Component = current(shell, slot);
        return Component === null ? null : <Component key={slot} app={props.app} />;
      })}
    </>
  );
}
