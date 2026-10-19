// M6a placeholder dialogs (B0a): `ui.open {dialog}` names exist from the foundation on (M6A-SPEC §4.6 UiDialog), so a
// dialog whose owner has not landed yet opens this card instead of failing. B8 replaces `makeEditableReport` (Make
// editable report), B13 `imagePlaneImport` (reference image import), each in its own file.
import { Dialog, DialogContent } from '@ekza-animator/ui';
import type { JSX } from 'react';
import { useShell } from '../shell/context';

function Pending(props: { readonly title: string; readonly testId: string }): JSX.Element {
  const shell = useShell();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void shell.runFromUi('ui.close');
      }}
    >
      <DialogContent title={props.title} width="md" data-testid={props.testId}>
        <p className="text-ui text-fg-2">This part of the modeling workspace is not available yet.</p>
      </DialogContent>
    </Dialog>
  );
}

export function MakeEditableReportDialog(): JSX.Element {
  return <Pending title="Make editable" testId="make-editable-report" />;
}

export function ImagePlaneImportDialog(): JSX.Element {
  return <Pending title="Import image plane" testId="image-plane-import" />;
}
