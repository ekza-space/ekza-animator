// Ports from headless operators to the editor's UI (M6A-SPEC §6.2, B9): `view.shading` and `view.display.set` change
// a viewport pane's display flags, which live in the ViewportManager; `ui.commandPalette` and `ui.markingMenu` open
// shell overlays. The operators stay registered with the built-ins (scripts, menus and the palette see them in every
// app) and poll-fail politely until the viewport or the shell provides its port. One port of each kind per app.
import type { Disposer } from '@ekza-studio/anim-core';
import type { DisplayFlags, EditorApp, MarkingMenuDef, RunContext } from '../types';

/** What the viewport offers the pane display operators (B9's ViewportManager). */
export interface PaneDisplayPort {
  /** The registered pane ids. */
  panes(): readonly string[];
  /** The pane view operators act on without an explicit or hovered pane (last pointer input, else the first). */
  activePane(): string | null;
  display(paneId: string): DisplayFlags | null;
  setDisplay(paneId: string, display: DisplayFlags): void;
}

/** What the shell offers the overlay operators (B9's command palette and marking menus). */
export interface ShellOverlayPort {
  openCommandPalette(): void;
  /** Opens a marking menu at the pointer (key-triggered: `ctx.source` 'keyboard'). */
  openMarkingMenu(menu: MarkingMenuDef, ctx: RunContext): void;
}

const paneDisplays = new WeakMap<object, PaneDisplayPort>();
const overlays = new WeakMap<object, ShellOverlayPort>();

function provide<T>(map: WeakMap<object, T>, app: EditorApp, port: T): Disposer {
  map.set(app, port);
  return () => {
    if (map.get(app) === port) map.delete(app);
  };
}

export function providePaneDisplay(app: EditorApp, port: PaneDisplayPort): Disposer {
  return provide(paneDisplays, app, port);
}

export function paneDisplayPort(app: EditorApp): PaneDisplayPort | null {
  return paneDisplays.get(app) ?? null;
}

export function provideShellOverlays(app: EditorApp, port: ShellOverlayPort): Disposer {
  return provide(overlays, app, port);
}

export function shellOverlayPort(app: EditorApp): ShellOverlayPort | null {
  return overlays.get(app) ?? null;
}
