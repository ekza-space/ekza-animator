// Renders the dialog named by `session.dialog` (opened and closed through `ui.open` / `ui.close`) and the shell's
// confirmation prompt.
import { Button, Dialog, DialogContent, DialogFooter } from '@ekza-animator/ui';
import type { JSX } from 'react';
import { useSession } from '../hooks';
import { useShellUi } from '../shell/context';
import { AboutDialog } from './AboutDialog';
import { ExportDialog } from './ExportDialog';
import { FirstRunDialog } from './FirstRunDialog';
import { ImportDialog } from './ImportDialog';
import { FilePickerDialog } from './OpenDialog';
import { PreferencesDialog } from './PreferencesDialog';
import { ShortcutsDialog } from './ShortcutsDialog';

function CurrentDialog(): JSX.Element | null {
  const dialog = useSession((s) => s.dialog);
  switch (dialog) {
    case null:
      return null;
    case 'firstRun':
      return <FirstRunDialog />;
    case 'open':
      return <FilePickerDialog mode="open" />;
    case 'import':
      return <ImportDialog />;
    case 'export':
      return <ExportDialog />;
    case 'about':
      return <AboutDialog />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'preferences':
      return <PreferencesDialog />;
  }
}

function ConfirmPrompt(): JSX.Element | null {
  const request = useShellUi((s) => s.confirm);
  if (request === null) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) request.resolve(false);
      }}
    >
      <DialogContent title={request.title} width="sm" data-testid="confirm-dialog">
        <p className="text-ui text-fg-2">{request.text}</p>
        <DialogFooter>
          <Button variant="ghost" data-testid="confirm-cancel" onClick={() => request.resolve(false)}>
            Cancel
          </Button>
          <Button variant="danger" data-testid="confirm-ok" onClick={() => request.resolve(true)}>
            {request.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DialogHost(): JSX.Element {
  return (
    <>
      <CurrentDialog />
      <ConfirmPrompt />
    </>
  );
}
