// The Studio shell (research 09 §2; AUTORIG-SPEC §4.4, D1): menu bar, status line, docks, fixed time slider, help
// line, plus Studio's overlays (marking menus, the shell slots). It renders inside `StudioHost`, which owns the GL
// canvas, the dialogs, the command palette, the toasts and the drop target on every route. `StudioShell` is the
// `/editor` route's shell: it creates the Studio shell core over the page's host when it mounts and disposes it when
// it unmounts (a switch to Auto-Rig), and it alone opens the first-run dialog.
import { switchWorkspace } from '@ekza-studio/editor-core';
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

export interface StudioShellProps {
  /** Panels to show; default: the built-in panels. */
  readonly panels?: PanelRegistry;
  /** Called once the shell is mounted, with its handle (harnesses expose it to specs). */
  readonly onShell?: ((shell: Shell) => (() => void) | undefined) | undefined;
}

export function StudioShell(props: StudioShellProps): JSX.Element {
  const host = useHost();
  const shell = useConstant(() => startStudio(host, props.panels));
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

  // The first-run dialog is Studio's (AUTORIG-SPEC §4.4): Auto-Rig never shows it.
  useEffect(() => {
    if (!shell.app.prefs.getState().firstRunDone && shell.app.session.getState().dialog === null) {
      void shell.runFromUi('ui.open', { dialog: 'firstRun' });
    }
  }, [shell]);

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
