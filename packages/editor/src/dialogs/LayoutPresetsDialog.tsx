// Windows › Presets (docs/LAYOUT-PRESETS.md): save the current layout under a name, and apply, rename or delete the
// user's presets of the active workspace. Every action runs a `workspace.preset.*` operator; the list follows the
// preset store.
import { Button, Dialog, DialogContent, DialogFooter, TextInput } from '@ekza-animator/ui';
import { type FormEvent, type JSX, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useSession } from '../hooks';
import { useShell } from '../shell/context';
import { PRESET_NAME_MAX, presetNameProblem, type UserPreset } from '../shell/presets';

function useUserPresets(workspace: string): readonly UserPreset[] {
  const { presets } = useShell();
  return useSyncExternalStore(
    (listener) => presets.subscribe(listener),
    () => presets.list(workspace),
    () => presets.list(workspace),
  );
}

function PresetRow(props: { readonly preset: UserPreset }): JSX.Element {
  const shell = useShell();
  const { preset } = props;
  const [renaming, setRenaming] = useState<string | null>(null);
  const testId = `layout-preset-${preset.name}`;
  const input = useRef<HTMLInputElement>(null);
  const editing = renaming !== null;
  // The rename field takes the focus when it opens (the dialog's own first field has it otherwise).
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const rename = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (renaming === null) return;
    const result = await shell.runFromUi('workspace.preset.rename', { id: preset.id, name: renaming });
    if (result.status === 'finished') setRenaming(null);
  };

  if (renaming !== null) {
    return (
      <li>
        <form className="flex items-center gap-2" onSubmit={(event) => void rename(event)}>
          <TextInput
            className="flex-1"
            aria-label={`New name for ${preset.name}`}
            ref={input}
            value={renaming}
            maxLength={PRESET_NAME_MAX}
            data-testid={`${testId}-rename-input`}
            onChange={(event) => setRenaming(event.currentTarget.value)}
          />
          <Button type="submit" size="sm" variant="primary" disabled={presetNameProblem(renaming) !== null}>
            Rename
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
            Cancel
          </Button>
        </form>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2" data-testid={testId}>
      <span className="min-w-0 flex-1 truncate text-fg">{preset.name}</span>
      <Button
        size="sm"
        variant="primary"
        data-testid={`${testId}-apply`}
        onClick={() => {
          void (async () => {
            const result = await shell.runFromUi('workspace.preset.apply', { preset: preset.id });
            if (result.status === 'finished') await shell.runFromUi('ui.close');
          })();
        }}
      >
        Apply
      </Button>
      <Button size="sm" variant="ghost" data-testid={`${testId}-rename`} onClick={() => setRenaming(preset.name)}>
        Rename
      </Button>
      <Button
        size="sm"
        variant="ghost"
        data-testid={`${testId}-delete`}
        onClick={() => void shell.runFromUi('workspace.preset.delete', { id: preset.id })}
      >
        Delete
      </Button>
    </li>
  );
}

export function LayoutPresetsDialog(): JSX.Element {
  const shell = useShell();
  const workspace = useSession((s) => s.workspace);
  const label = shell.app.workspaces.get(workspace)?.label ?? workspace;
  const presets = useUserPresets(workspace);
  const [name, setName] = useState('');
  const nameId = useId();
  const problem = name === '' ? null : presetNameProblem(name);
  const replaces = presets.find((preset) => preset.name.toLowerCase() === name.trim().toLowerCase());
  const close = (): void => void shell.runFromUi('ui.close');

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const result = await shell.runFromUi('workspace.preset.save', { name });
    if (result.status !== 'finished') return;
    setName('');
    if (!shell.presets.persistent()) {
      shell.help('Preset saved for this session only: the browser blocks storage', 'warning');
    }
    close();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        title="Layout Presets"
        description={`Presets of the ${label} workspace: panels, tool strip, help line, time slider and viewport panes.`}
        width="md"
        data-testid="layout-presets-dialog"
      >
        <form className="flex flex-col gap-1.5" onSubmit={(event) => void save(event)}>
          <label htmlFor={nameId} className="text-ui font-semibold text-fg">
            Save the current layout as
          </label>
          <div className="flex items-center gap-2">
            <TextInput
              id={nameId}
              className="flex-1"
              placeholder="Preset name"
              value={name}
              maxLength={PRESET_NAME_MAX}
              aria-invalid={problem !== null}
              data-testid="layout-preset-name"
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={name.trim() === '' || problem !== null}
              data-testid="layout-preset-save"
            >
              {replaces === undefined ? 'Save' : 'Replace'}
            </Button>
          </div>
          {problem === null ? null : <p className="text-ui-dense text-danger">{problem}</p>}
          {replaces === undefined ? null : (
            <p className="text-ui-dense text-fg-3">Replaces the preset “{replaces.name}”.</p>
          )}
        </form>
        <section className="mt-4 flex flex-col gap-2 text-ui text-fg-2">
          <h3 className="font-semibold text-fg">Your presets</h3>
          {presets.length === 0 ? (
            <p className="text-fg-3" data-testid="layout-presets-empty">
              No presets in this workspace yet. The built-in ones are in Windows › Presets (Alt+1…Alt+4).
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5" data-testid="layout-presets-list">
              {presets.map((preset) => (
                <PresetRow key={preset.id} preset={preset} />
              ))}
            </ul>
          )}
          {shell.presets.persistent() ? null : (
            <p className="text-warn" data-testid="layout-presets-session-only">
              The browser blocks storage: presets are kept until the page reloads.
            </p>
          )}
        </section>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
