// Minimal preferences (MVP-SPEC §7 WP-8; research 09 §9.2): navigation profile, Space behaviour, auto-key mode,
// import reduction, Graph Editor handles; Reset Workspace. Preferences are P state, never written to the document.
import type { Prefs } from '@ekza-studio/editor-core';
import { Button, Dialog, DialogContent, DialogFooter, NativeSelect } from '@ekza-studio/ui';
import type { JSX, ReactNode } from 'react';
import { usePrefs } from '../hooks';
import { useShell } from '../shell/context';

function Row(props: { readonly label: string; readonly hint?: string; readonly children: ReactNode }): JSX.Element {
  return (
    <label className="grid grid-cols-[200px_1fr] items-center gap-3 text-ui">
      <span className="flex flex-col">
        <span className="text-fg">{props.label}</span>
        {props.hint === undefined ? null : <span className="text-ui-dense text-fg-3">{props.hint}</span>}
      </span>
      {props.children}
    </label>
  );
}

export function PreferencesDialog(): JSX.Element {
  const shell = useShell();
  const navProfile = usePrefs((p) => p.navProfile);
  const spaceBehaviour = usePrefs((p) => p.spaceBehaviour);
  const autoKeyMode = usePrefs((p) => p.autoKeyMode);
  const reduceOnImport = usePrefs((p) => p.reduceOnImport);
  const graphHandles = usePrefs((p) => p.graphHandles);
  const set = (patch: Partial<Omit<Prefs, 'version'>>): void => {
    void shell.runFromUi('prefs.set', { patch });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void shell.runFromUi('ui.close');
      }}
    >
      <DialogContent title="Preferences" width="md" data-testid="preferences-dialog">
        <div className="flex flex-col gap-3">
          <Row label="Navigation" hint="Viewport and Graph Editor gestures">
            <NativeSelect
              value={navProfile}
              data-testid="prefs-nav"
              onChange={(event) => {
                const value = event.currentTarget.value;
                set({ navProfile: value === 'trackpad' || value === 'mayaOneButton' ? value : 'maya' });
              }}
              options={[
                { value: 'maya', label: 'Mouse — Maya (Alt + drag)' },
                { value: 'trackpad', label: 'Trackpad (scroll, pinch)' },
                { value: 'mayaOneButton', label: 'One-button mouse (Option + drag)' },
              ]}
            />
          </Row>
          <Row label="Space key">
            <NativeSelect
              value={spaceBehaviour}
              data-testid="prefs-space"
              onChange={(event) => set({ spaceBehaviour: event.currentTarget.value === 'play' ? 'play' : 'maya' })}
              options={[
                { value: 'maya', label: 'Tap maximizes the panel under the pointer' },
                { value: 'play', label: 'Play and stop' },
              ]}
            />
          </Row>
          <Row label="Auto key" hint="Which channels auto-key writes">
            <NativeSelect
              value={autoKeyMode}
              data-testid="prefs-autokey-mode"
              onChange={(event) => set({ autoKeyMode: event.currentTarget.value === 'all' ? 'all' : 'keyed-only' })}
              options={[
                { value: 'keyed-only', label: 'Only channels that have keys (Maya)' },
                { value: 'all', label: 'Every edited channel' },
              ]}
            />
          </Row>
          <Row label="Reduce keys on import" hint="Error-bounded key reduction of embedded clips">
            <NativeSelect
              value={reduceOnImport}
              data-testid="prefs-reduce"
              onChange={(event) => {
                const value = event.currentTarget.value;
                set({ reduceOnImport: value === 'always' || value === 'never' ? value : 'auto' });
              }}
              options={[
                { value: 'auto', label: 'Automatic (dense clips only)' },
                { value: 'always', label: 'Always' },
                { value: 'never', label: 'Never' },
              ]}
            />
          </Row>
          <Row label="Graph Editor handles">
            <NativeSelect
              value={graphHandles}
              data-testid="prefs-graph-handles"
              onChange={(event) => set({ graphHandles: event.currentTarget.value === 'all' ? 'all' : 'selected' })}
              options={[
                { value: 'selected', label: 'Selected keys only' },
                { value: 'all', label: 'All keys' },
              ]}
            />
          </Row>
        </div>
        <DialogFooter className="justify-between">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              data-testid="prefs-reset-workspace"
              onClick={() => void shell.runFromUi('workspace.reset')}
            >
              Reset workspace
            </Button>
            <Button variant="ghost" onClick={() => void shell.runFromUi('ui.open', { dialog: 'firstRun' })}>
              Show welcome again
            </Button>
          </div>
          <Button variant="primary" onClick={() => void shell.runFromUi('ui.close')}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
