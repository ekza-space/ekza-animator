// The Animate workspace chrome (research 09 §2): menu bar, status line, docks, fixed time slider, help line, plus
// the overlays (dialogs, toasts, drop target). Sits above the GL host's canvas.
import type { JSX } from 'react';
import { DialogHost } from '../dialogs/DialogHost';
import { CommandPaletteHost } from '../overlays/CommandPalette';
import { MarkingMenuHost } from '../overlays/MarkingMenu';
import { ShellOverlays } from '../overlays/slots';
import type { ToastNotifier } from '../services/notify';
import { useShell, useShellUi } from './context';
import { HelpLine } from './HelpLine';
import { MenuBar } from './MenuBar';
import { StatusLine } from './StatusLine';
import { TimelineRegion } from './TimelineRegion';
import { Toaster } from './Toaster';
import { WorkspaceHost } from './WorkspaceHost';

function DropOverlay(): JSX.Element | null {
  const dragOver = useShellUi((s) => s.dragOver);
  if (!dragOver) return null;
  return (
    <div
      className="pointer-events-none fixed inset-1 z-(--z-ghost) grid place-items-center rounded-dialog border-2 border-dashed border-accent bg-drop-overlay"
      data-testid="drop-overlay"
    >
      <span className="rounded-popover bg-popover px-4 py-2 text-dialog font-semibold text-fg shadow-popover">
        Drop to import
      </span>
    </div>
  );
}

/** M6a overlays (§4.8, §5.18): the marking menu, the command palette and the shell slots (B11's option box). */
function ShellOverlaysHost(): JSX.Element {
  const shell = useShell();
  return (
    <>
      <MarkingMenuHost menus={shell.markingMenus} />
      <CommandPaletteHost palette={shell.commandPalette} />
      <ShellOverlays app={shell.app} />
    </>
  );
}

export function EditorShell(props: { readonly toasts: ToastNotifier | null }): JSX.Element {
  return (
    <>
      <div className="relative z-(--z-chrome) flex h-full w-full flex-col" data-testid="editor-shell">
        <MenuBar />
        <StatusLine />
        <main className="relative min-h-0 flex-1" aria-label="Workspace">
          <WorkspaceHost />
        </main>
        <TimelineRegion />
        <HelpLine />
      </div>
      <DialogHost />
      <ShellOverlaysHost />
      {props.toasts === null ? null : <Toaster notifier={props.toasts} />}
      <DropOverlay />
    </>
  );
}
