// The shell's confirmation prompt (`shell.confirm`): title, text, Cancel and the confirming action. Loaded lazily by
// the dialog host (M2A-SPEC §5.21.2).
import { Button, Dialog, DialogContent, DialogFooter } from '@ekza-studio/ui';
import type { JSX } from 'react';
import type { ConfirmRequest } from '../shell/types';

export function ConfirmDialog(props: { readonly request: ConfirmRequest }): JSX.Element {
  const { request } = props;
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
