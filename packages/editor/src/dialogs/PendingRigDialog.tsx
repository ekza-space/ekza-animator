// Placeholder of the Rig & Skin dialogs (M6B-SPEC §4.6 `UiDialog`; C0): `applyPoseAsRest`, `unbindSkin`, `rebindSkin`,
// `vrmMeta`, `makeCharacterEditable`, `attachProp`. Each owner replaces its loader line in ./DialogHost.tsx with the
// real dialog (C4/C6 the bind confirms, C10 VRM Meta, the deferred ones after the MVP).
import { Dialog, DialogContent } from '@ekza-studio/ui';
import type { JSX } from 'react';
import { useSession } from '../hooks';
import { useShell } from '../shell/context';

export function PendingRigDialog(): JSX.Element {
  const shell = useShell();
  const dialog = useSession((s) => s.dialog);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void shell.runFromUi('ui.close');
      }}
    >
      <DialogContent title={dialog ?? 'Rig & Skin'} width="md" data-testid="pending-rig-dialog">
        <p className="text-ui text-fg-2">This dialog is not available yet.</p>
      </DialogContent>
    </Dialog>
  );
}
