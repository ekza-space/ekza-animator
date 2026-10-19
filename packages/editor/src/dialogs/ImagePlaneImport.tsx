// The reference image import dialog (M6A-SPEC §5.26, §8.3 Create › Reference Image; B13): a PNG or JPEG for the front,
// side or top view (the menu item's view preselected), its name, then `imagePlane.import {camera, name, bytes}` — one
// undo step. The new plane becomes the selected plane, so the Attributes panel shows its Image plane section.
import { pendingImagePlaneCamera } from '@ekza-animator/editor-core';
import { Button, Dialog, DialogContent, DialogFooter, RadioGroup, RadioGroupItem, TextInput } from '@ekza-animator/ui';
import { type JSX, useId, useState } from 'react';
import { setSelectedPlane } from '../panels/outliner/planeSelection';
import { useShell } from '../shell/context';

type Camera = 'front' | 'side' | 'top';

const VIEW_HINT: Readonly<Record<Camera, string>> = {
  front: 'Drawn in the front view, looking along −Z',
  side: 'Drawn in the side view, looking along −X',
  top: 'Drawn in the top view, looking down',
};

export function ImagePlaneImportDialog(): JSX.Element {
  const shell = useShell();
  const { app } = shell;
  const ids = useId();
  const [camera, setCamera] = useState<Camera>(() => pendingImagePlaneCamera(app));
  const [file, setFile] = useState<{ readonly name: string; readonly bytes: Uint8Array } | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const close = (): void => void shell.runFromUi('ui.close');
  const importPlane = async (): Promise<void> => {
    if (file === null) return;
    setRunning(true);
    setError(null);
    try {
      const result = await app.runUntyped('imagePlane.import', {
        camera,
        name: name.trim() === '' ? file.name : name,
        bytes: file.bytes,
      });
      if (result.status === 'finished') {
        const id = (result.value as { id: string | null }).id;
        if (id !== null) setSelectedPlane(app, id as never);
        close();
      } else {
        setError(result.status === 'failed' ? result.error.message : result.reason);
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        title="Import reference image"
        description="A PNG or JPEG drawn behind the model in one orthographic view. It is saved with the project and never exported."
        width="md"
        data-testid="image-plane-import"
      >
        <div className="flex flex-col gap-3 text-ui text-fg-2">
          <label className="flex flex-col gap-1" htmlFor={`${ids}-file`}>
            Image file
            <input
              id={`${ids}-file`}
              type="file"
              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
              className="text-ui text-fg"
              data-testid="image-plane-file"
              onChange={(event) => {
                const chosen = event.currentTarget.files?.[0];
                if (chosen === undefined) return;
                void chosen.arrayBuffer().then((buffer) => {
                  setFile({ name: chosen.name, bytes: new Uint8Array(buffer) });
                  setName((current) => (current.trim() === '' ? chosen.name.replace(/\.[^.]+$/, '') : current));
                  setError(null);
                });
              }}
            />
          </label>
          <RadioGroup value={camera} onValueChange={(value) => setCamera(value as Camera)} aria-label="View">
            {(['front', 'side', 'top'] as const).map((view) => (
              <RadioGroupItem
                key={view}
                value={view}
                label={view.charAt(0).toUpperCase() + view.slice(1)}
                hint={VIEW_HINT[view]}
                data-testid={`image-plane-camera-${view}`}
              />
            ))}
          </RadioGroup>
          <label className="flex flex-col gap-1" htmlFor={`${ids}-name`}>
            Name
            <TextInput
              id={`${ids}-name`}
              value={name}
              placeholder="Front reference"
              data-testid="image-plane-name"
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          {error === null ? null : (
            <p className="text-danger" role="alert" data-testid="image-plane-error">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={file === null || running}
            data-testid="image-plane-confirm"
            onClick={() => void importPlane()}
          >
            {running ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
