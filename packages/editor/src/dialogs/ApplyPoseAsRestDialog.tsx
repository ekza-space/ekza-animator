// The Apply Pose as Rest confirm (M6B-SPEC §5.7; AUTORIG-SPEC §10 A0): a UI run of `skel.pose.applyAsRest` on a
// character with clips asks first — "Clips authored on the old rest shift by the pose delta (n clips). Do this before
// animating." — and the answer re-runs it with `confirm: true` (the operator keeps the asking run's character and
// pose). The operator names the asked character the Rig & Skin character, so the count is that character's clips
// (generated test clips are never exported and do not count). Loaded lazily by the dialog host (D0's loader line).
import type { CharacterId } from '@ekza-studio/doc';
import { Button, Dialog, DialogContent, DialogFooter } from '@ekza-studio/ui';
import type { JSX } from 'react';
import { useEditorApp } from '../hooks';

export function ApplyPoseAsRestDialog(): JSX.Element {
  const app = useEditorApp();
  const character: CharacterId | null = app.session.getState().rig.character;
  const clips =
    character === null
      ? 0
      : app.store.query.clipsOfCharacter(character).filter((clip) => clip.source.kind !== 'test').length;
  const close = (): void => {
    if (app.session.getState().dialog === 'applyPoseAsRest') app.session.setState({ dialog: null });
  };
  const apply = (): void => {
    close();
    void app.runUntyped('skel.pose.applyAsRest', { confirm: true }, { source: 'menu' }).then((result) => {
      if (result.status === 'finished') return;
      app.services.notify.toast({
        kind: 'error',
        text: `Apply Pose as Rest failed: ${result.status === 'failed' ? result.error.message : result.reason}`,
      });
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent title="Apply Pose as Rest" width="sm" data-testid="apply-pose-as-rest-dialog">
        <p className="text-ui text-fg-2" data-testid="apply-pose-as-rest-text">
          Clips authored on the old rest shift by the pose delta ({clips} clip{clips === 1 ? '' : 's'}). Do this before
          animating.
        </p>
        <DialogFooter>
          <Button variant="ghost" data-testid="apply-pose-as-rest-cancel" onClick={close}>
            Cancel
          </Button>
          <Button variant="danger" data-testid="apply-pose-as-rest-ok" onClick={apply}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
