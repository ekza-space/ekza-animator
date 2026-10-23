// The grants dialog (MCP-SPEC §7.3): modal after `pair.claimed` (status `claimed`). Read is always on, Edit on by
// default, Files (with its Workspace folder sub-option) and View off. `Esc` = Deny; outside clicks do not close it;
// the session times it out with the code (Deny).
import { Button, Checkbox, Dialog, DialogContent, DialogFooter } from '@ekza-studio/ui';
import { type JSX, useState, useSyncExternalStore } from 'react';
import type { AgentSessionState } from '../types';
import type { AgentSessionExtraView, AgentSessionHandle } from './runtime';

export interface GrantChoice {
  readonly edit: boolean;
  readonly files: boolean;
  readonly workspace: boolean;
  readonly view: boolean;
}
export const DEFAULT_GRANTS: GrantChoice = { edit: true, files: false, workspace: false, view: false };

export const GRANT_TEXT = {
  read: 'See the project: characters, clips, keys, poses, pictures of the viewport. Always on.',
  edit: 'Change animation (keys, poses, clips). Every change is one undo step labelled "AI: …".',
  files: 'Save and export files as downloads (you confirm each one) and open or import files.',
  workspace: 'Also move files to and from the agent’s folder.',
  view: 'Change what you see: your selection, playhead, panes and cameras; show unkeyed pose proposals.',
} as const;

/** The grant checkboxes shared by the dialog and the panel (same test ids, §7.7). */
export function GrantList(props: {
  readonly value: GrantChoice;
  readonly onChange: (next: GrantChoice) => void;
  readonly disabled?: boolean;
  readonly dense?: boolean;
}): JSX.Element {
  const { value, onChange, disabled = false, dense = false } = props;
  const row = (key: 'read' | keyof GrantChoice, label: string, checked: boolean, off: boolean): JSX.Element => (
    <div className={dense ? 'flex items-center' : 'flex flex-col gap-0.5'} key={key}>
      <Checkbox
        label={label}
        checked={checked}
        disabled={off}
        data-testid={`agent-grant-${key}`}
        onChange={(event) => {
          if (key === 'read') return;
          const next = { ...value, [key]: event.target.checked };
          onChange(key === 'files' && !event.target.checked ? { ...next, workspace: false } : next);
        }}
      />
      {dense ? null : <span className="pl-5.5 text-fg-3">{GRANT_TEXT[key]}</span>}
    </div>
  );
  return (
    <div className={dense ? 'flex flex-wrap items-center gap-x-3 gap-y-1' : 'flex flex-col gap-2'}>
      {row('read', 'Read', true, true)}
      {row('edit', 'Edit', value.edit, disabled)}
      {row('files', 'Files', value.files, disabled)}
      <div className={dense ? '' : 'pl-5.5'}>
        {row('workspace', 'Workspace folder', value.workspace, disabled || !value.files)}
      </div>
      {row('view', 'View', value.view, disabled)}
    </div>
  );
}

const noSubscribe = (): (() => void) => () => {};
const noExtra = (): AgentSessionExtraView | null => null;

export function GrantsDialog(props: {
  readonly state: AgentSessionState;
  readonly session: AgentSessionHandle;
}): JSX.Element | null {
  const [choice, setChoice] = useState<GrantChoice>(DEFAULT_GRANTS);
  const extra = props.session.extra;
  const claim = useSyncExternalStore(
    extra === undefined ? noSubscribe : extra.subscribe,
    extra === undefined ? noExtra : extra.getState,
    extra === undefined ? noExtra : extra.getState,
  )?.claim;
  if (props.state.status !== 'claimed') return null;
  const client = claim?.client?.name ?? props.state.server?.client?.name ?? 'An agent';
  const folder = claim?.cwdName ?? null;
  const answer = (value: 'allow' | 'deny'): void => {
    if (value === 'allow')
      props.session.accept?.({ ...choice, read: true, workspace: choice.files && choice.workspace });
    else props.session.deny?.();
    setChoice(DEFAULT_GRANTS);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) answer('deny');
      }}
    >
      <DialogContent
        title={`${client} wants to work in this editor`}
        description={`Name reported by the agent; the editor cannot verify it.${
          props.state.code === null ? '' : ` Code ${props.state.code.text}.`
        }${folder === null ? '' : ` Folder "${folder}".`}`}
        hideClose
        width="md"
        data-testid="agent-grants"
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <GrantList value={choice} onChange={setChoice} />
        <p className="mt-3 text-ui text-fg-3">
          You can change these, pause or disconnect at any time in Windows › Agent.
        </p>
        <DialogFooter>
          <Button data-testid="agent-deny" onClick={() => answer('deny')}>
            Deny
          </Button>
          <Button
            variant="primary"
            data-testid="agent-allow"
            disabled={props.session.accept === undefined}
            onClick={() => answer('allow')}
          >
            Allow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
