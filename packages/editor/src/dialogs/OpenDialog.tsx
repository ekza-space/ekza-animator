// Open / Import dialogs without a pending file: a file picker (accepting every registered importer's extensions)
// and the bundled samples. The chosen file goes through the same pipeline as drag-and-drop.
import { Button, Dialog, DialogContent, FolderOpen } from '@ekza-animator/ui';
import { type JSX, useRef } from 'react';
import { useRegistryList } from '../hooks/useRegistry';
import { useShell } from '../shell/context';
import { acceptAttribute } from '../shell/importers';
import { SAMPLES } from './samples';

export function FilePickerDialog(props: { readonly mode: 'open' | 'import' }): JSX.Element {
  const shell = useShell();
  const { app } = shell;
  useRegistryList(app.importers);
  const input = useRef<HTMLInputElement>(null);
  const close = (): void => void shell.runFromUi('ui.close');
  const sampleAvailable = app.operators.get('file.loadSample') !== undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        title={props.mode === 'open' ? 'Open' : 'Import'}
        description={
          props.mode === 'open'
            ? 'Open a project (.ekzanim) or a model (.glb, .vrm). You can also drop files anywhere on the window.'
            : 'Import a model (.glb, .vrm) or a VRM animation (.vrma) into the scene.'
        }
        data-testid={`${props.mode}-dialog`}
      >
        <div className="flex flex-col gap-4">
          <input
            ref={input}
            type="file"
            className="sr-only"
            accept={acceptAttribute(app.importers)}
            data-testid={`${props.mode}-file-input`}
            onChange={(event) => {
              const files = [...(event.currentTarget.files ?? [])];
              event.currentTarget.value = '';
              if (files.length === 0) return;
              void (async () => {
                await shell.runFromUi('ui.close');
                await shell.files.openFiles(files);
              })();
            }}
          />
          <Button
            variant="primary"
            className="self-start"
            data-testid={`${props.mode}-choose`}
            onClick={() => input.current?.click()}
          >
            <FolderOpen size={14} />
            Choose file…
          </Button>
          <section className="flex flex-col gap-2">
            <h3 className="text-ui font-semibold text-fg-2">Samples</h3>
            <ul className="flex flex-col gap-1.5">
              {SAMPLES.map((sample) => (
                <li
                  key={sample.id}
                  className="flex items-center justify-between gap-3 rounded-button border border-line px-3 py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-ui text-fg">
                      {sample.title} <span className="text-fg-3">· {sample.kind}</span>
                    </span>
                    <span className="truncate text-ui-dense text-fg-3">
                      {sample.credit}, {sample.license}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    disabled={!sampleAvailable}
                    title={sampleAvailable ? undefined : 'Samples are not available in this build'}
                    data-testid={`${props.mode}-sample-${sample.id}`}
                    onClick={() => {
                      void (async () => {
                        await shell.runFromUi('ui.close');
                        await shell.runFromUi('file.loadSample', { sample: sample.id });
                      })();
                    }}
                  >
                    Load
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
