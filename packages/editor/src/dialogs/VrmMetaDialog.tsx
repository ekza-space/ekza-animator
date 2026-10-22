// VRM Meta… (M6B-SPEC §5.22, §8.13, `ui.open {dialog: 'vrmMeta'}`; C10): the VRM meta of the Rig & Skin (or active)
// model character — name, authors, the licence preset, permissions, contact and references — each committed edit one
// `char.setVrmMeta` step, and its thumbnail with Render.
import { characterOf } from '@ekza-studio/editor-core';
import { Button, Dialog, DialogContent, DialogFooter } from '@ekza-studio/ui';
import type { JSX } from 'react';
import { useSession } from '../hooks';
import { useShell } from '../shell/context';
import { ThumbnailPreview } from './export/character/ThumbnailPreview';
import { VrmMetaFields } from './export/character/VrmMetaFields';

export function VrmMetaDialog(): JSX.Element {
  const shell = useShell();
  const { app } = shell;
  // Re-read when the Rig & Skin or active character changes.
  useSession((s) => `${s.rig.character ?? ''}:${s.activeCharacter ?? ''}`);
  const character = characterOf(app, undefined);
  const record = character === null ? undefined : app.store.get('characters', character);
  const run = (op: string, args: unknown) => shell.runFromUi(op, args);
  const close = () => void shell.runFromUi('ui.close');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        title={record === undefined ? 'VRM Meta' : `VRM Meta — ${record.name}`}
        width="lg"
        data-testid="vrm-meta-dialog"
      >
        {character === null || record === undefined || record.source?.kind !== 'model' ? (
          <p className="text-ui text-fg-2">Make a character from your model first (Rig & Skin › Quick Rig).</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[auto_1fr]">
            <ThumbnailPreview app={app} character={character} run={run} />
            <VrmMetaFields app={app} character={character} run={run} />
          </div>
        )}
        <DialogFooter>
          <Button variant="primary" data-testid="vrm-meta-done" onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
