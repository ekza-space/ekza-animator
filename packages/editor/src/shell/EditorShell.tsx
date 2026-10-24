// The Studio shell (research 09 §2; AUTORIG-SPEC §4.4, D1): menu bar, status line, docks, fixed time slider, help
// line, plus Studio's overlays (marking menus, the shell slots). It renders inside `StudioHost`, which owns the GL
// canvas, the dialogs, the command palette, the toasts and the drop target on every route. `StudioShell` is the
// `/editor` route's shell: it creates the Studio shell core over the page's host when it mounts and disposes it when
// it unmounts (a switch to Auto-Rig or Halo), and it alone opens the first-run dialog. STUDIO-TOUCH-SPEC §16.1 (T2):
// arriving from Halo (`from=halo`) it opens no first-run dialog either, and it applies a switch's arrival action.
import { type ArrivalAction, switchWorkspace } from '@ekza-studio/editor-core';
import { TooltipProvider } from '@ekza-studio/ui';
import { type JSX, useEffect } from 'react';
import { useHost } from '../host/context';
import { shellShown } from '../host/StudioHost';
import type { HostShell } from '../host/types';
import { MarkingMenuHost } from '../overlays/MarkingMenu';
import { ShellOverlays } from '../overlays/slots';
import type { PanelRegistry } from '../panels/types';
import { ShellProvider, useShell } from './context';
import { createShell } from './createShell';
import { HelpLine } from './HelpLine';
import { MenuBar } from './MenuBar';
import { StatusLine } from './StatusLine';
import { TimelineRegion, useChromeShown } from './TimelineRegion';
import type { Shell } from './types';
import { useConstant } from './useConstant';
import { WorkspaceHost } from './WorkspaceHost';

/** `check-size` marker of the Studio shell's entry (AUTORIG-SPEC §7.2): a boundary `/autorig` must never load. */
export const STUDIO_SHELL_MARKER = 'ekza-studio-shell' as const;

/** M6a overlays (§4.8, §5.18): the marking menu and the shell slots (B11's option box). */
function ShellOverlaysHost(): JSX.Element {
  const shell = useShell();
  return (
    <>
      <MarkingMenuHost menus={shell.markingMenus} />
      <ShellOverlays app={shell.app} />
    </>
  );
}

export function EditorShell(): JSX.Element {
  // Layout presets (docs/LAYOUT-PRESETS.md): the tool strip and the help line can be hidden per workspace.
  const toolbar = useChromeShown('toolbar');
  const helpLine = useChromeShown('helpLine');
  return (
    <>
      <div className="relative z-(--z-chrome) flex h-full w-full flex-col" data-testid="editor-shell">
        <MenuBar />
        {toolbar ? <StatusLine /> : null}
        <main className="relative min-h-0 flex-1" aria-label="Workspace">
          <WorkspaceHost />
        </main>
        <TimelineRegion />
        {helpLine ? <HelpLine /> : null}
      </div>
      <ShellOverlaysHost />
    </>
  );
}

/**
 * The workspace a Studio shell starts in (M6A-SPEC §4.8, §5.17; AUTORIG-SPEC §3.4): the one a switch from Auto-Rig
 * asked for; else, when Studio is the page's first shell, `ws=<id>` or the workspace the user left
 * (`prefs.lastWorkspace`); else the current one. Applied through `workspace.set`'s switching rules before the shell builds its layout.
 */
function startStudio(host: HostShell, panels: PanelRegistry | undefined): Shell {
  const { app } = host;
  // The page's first shell applies `ws=` or the remembered workspace; a shell arriving by a switch keeps the session's.
  const first = !shellShown.has(host);
  const startIn =
    host.navigation.takeWorkspace() ?? (first ? (host.params.ws ?? app.prefs.getState().lastWorkspace) : null);
  if (
    startIn !== null &&
    app.workspaces.get(startIn)?.enabled === true &&
    startIn !== app.session.getState().workspace
  ) {
    switchWorkspace(app, startIn);
  }
  return createShell({ host, ...(panels === undefined ? {} : { panels }) });
}

const disposals = new Map<Shell, ReturnType<typeof setTimeout>>();

/** The operator each kind of arrival action runs with the action as its arguments (STUDIO-TOUCH-SPEC §16.1, T2). */
const ARRIVAL_OPS = { preset: 'workspace.preset.apply', panel: 'workspace.showPanel', dialog: 'ui.open' } as const;

/**
 * Applies a same-page switch's arrival action once the shell shows (Halo's Curves → the Polish preset, its Share
 * sheet → the Export dialog): presets and panels wait up to 60 frames for the dockview workspace to attach.
 */
function applyArrival(shell: Shell, arrival: ArrivalAction, tries = 60): void {
  if (shell.mounted.getState() !== shell) return;
  if (arrival.kind !== 'dialog' && shell.workspace.dockview === null && tries > 0) {
    requestAnimationFrame(() => applyArrival(shell, arrival, tries - 1));
    return;
  }
  void shell.runFromUi(ARRIVAL_OPS[arrival.kind], arrival);
}

export interface StudioShellProps {
  /** Panels to show; default: the built-in panels. */
  readonly panels?: PanelRegistry;
  /** Called once the shell is mounted, with its handle (harnesses expose it to specs). */
  readonly onShell?: ((shell: Shell) => (() => void) | undefined) | undefined;
}

export function StudioShell(props: StudioShellProps): JSX.Element {
  const host = useHost();
  // Arriving from Auto-Rig or Halo (a switch on this page, or `from=`): no first-run dialog over the hand-over
  // (AR-D8-6, STUDIO-TOUCH-SPEC §16.1). A same-page switch's arrival action is read once with the shell.
  const [shell, arrived, arrival] = useConstant(
    () =>
      [
        startStudio(host, props.panels),
        shellShown.has(host) || host.params.from !== null,
        host.navigation.takeArrival(),
      ] as const,
  );
  const { onShell } = props;

  // Dispose on a real unmount only: StrictMode's effect replay re-runs the setup immediately and cancels it.
  useEffect(() => {
    const pending = disposals.get(shell);
    if (pending !== undefined) {
      clearTimeout(pending);
      disposals.delete(shell);
    }
    const unmount = host.mount(shell);
    return () => {
      unmount();
      disposals.set(
        shell,
        setTimeout(() => {
          disposals.delete(shell);
          shell.dispose();
        }, 0),
      );
    };
  }, [host, shell]);

  useEffect(() => onShell?.(shell), [shell, onShell]);

  // STUDIO-TOUCH-SPEC §16.1 (T2): what the switch asked Studio to open (after the mount effect above made it current).
  useEffect(() => {
    if (arrival !== null) applyArrival(shell, arrival);
  }, [shell, arrival]);

  // The first-run dialog is Studio's (AUTORIG-SPEC §4.4): Auto-Rig never shows it, nor a hand-over from it.
  useEffect(() => {
    if (!arrived && !shell.app.prefs.getState().firstRunDone && shell.app.session.getState().dialog === null) {
      void shell.runFromUi('ui.open', { dialog: 'firstRun' });
    }
  }, [shell, arrived]);

  return (
    // The tooltip provider is Studio's (AR-D3-G): Auto-Rig's chrome uses `title`, so `/autorig` never loads Radix's
    // tooltip layer at first visit; a tooltip outside a provider (a host dialog) creates its own.
    <TooltipProvider>
      <ShellProvider shell={shell}>
        <div className="contents" data-shell={STUDIO_SHELL_MARKER}>
          <EditorShell />
        </div>
      </ShellProvider>
    </TooltipProvider>
  );
}
