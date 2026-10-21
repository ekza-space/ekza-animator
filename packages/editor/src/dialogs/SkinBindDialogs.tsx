// The Bind Skin confirms (M6B-SPEC §5.9; C6 UI over C4's questions): `rebindSkin` ("Rebind replaces painted weights on
// 612 points of body. Undo restores them." — Rebind / Only selected points / Cancel) and `unbindSkin` ("Weights are
// discarded (undo restores them)" — Unbind / Cancel). Each answer runs through `answerRebind` / `answerUnbind`, which
// close the dialog. Loaded lazily by the dialog host.
import { answerRebind, answerUnbind, rebindRequest, unbindRequest } from '@ekza-studio/editor-core';
import { Button, Dialog, DialogContent, DialogFooter } from '@ekza-studio/ui';
import type { JSX } from 'react';
import { useEditorApp } from '../hooks';

export function RebindSkinDialog(): JSX.Element {
  const app = useEditorApp();
  const request = rebindRequest(app);
  const answer = (choice: 'rebind' | 'selected' | 'cancel'): void => void answerRebind(app, choice);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) answer('cancel');
      }}
    >
      <DialogContent title="Rebind Skin" width="sm" data-testid="rebind-skin-dialog">
        <p className="text-ui text-fg-2">{request?.text ?? 'Rebind replaces painted weights. Undo restores them.'}</p>
        <DialogFooter>
          <Button variant="ghost" data-testid="rebind-cancel" onClick={() => answer('cancel')}>
            Cancel
          </Button>
          <Button variant="ghost" data-testid="rebind-selected" onClick={() => answer('selected')}>
            Only selected points
          </Button>
          <Button variant="danger" data-testid="rebind-ok" onClick={() => answer('rebind')}>
            Rebind
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UnbindSkinDialog(): JSX.Element {
  const app = useEditorApp();
  const meshes = unbindRequest(app) ?? [];
  const names = meshes.map((id) => app.store.get('meshes', id)?.name ?? id).join(', ');
  const answer = (choice: 'unbind' | 'cancel'): void => void answerUnbind(app, choice);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) answer('cancel');
      }}
    >
      <DialogContent title="Unbind Skin" width="sm" data-testid="unbind-skin-dialog">
        <p className="text-ui text-fg-2">
          {names === '' ? '' : `${names}: `}Weights are discarded (undo restores them).
        </p>
        <DialogFooter>
          <Button variant="ghost" data-testid="unbind-cancel" onClick={() => answer('cancel')}>
            Cancel
          </Button>
          <Button variant="danger" data-testid="unbind-ok" onClick={() => answer('unbind')}>
            Unbind
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
