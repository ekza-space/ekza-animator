// The Agent panel (MCP-SPEC §7.2; MVP cut §0.4.1 item 4; B3): the connection section by session state (Connect,
// server chooser, the pairing code, Pause / Resume, Disconnect, errors), the grants, the audit log of the AI's calls
// (newest first) with Show and Undo or Revert per step, and "Revert all AI changes since pairing". It reads the frozen
// D0 `AgentSessionState`; the session (B2) does discovery, pairing and execution. A lazy chunk: loading it also puts
// the live status pill in the status line.
import { Button } from '@ekza-studio/ui';
import { type JSX, useEffect, useState } from 'react';
import { useRunOperator } from '../../hooks';
import type { PanelProps } from '../../panels/types';
import type { AgentSessionState } from '../types';
import { revertAll, revertAllTargets } from '../ui/actions';
import { DEFAULT_GRANTS, GrantList } from '../ui/GrantsDialog';
import { useAgentRuntime, useAgentSessionState, useNow } from '../ui/hooks';
import { LivePill } from '../ui/LivePill';
import type { AgentRuntime, AgentSessionHandle } from '../ui/runtime';
import { setAgentPill } from '../ui/slot';
import { AuditLog } from './AuditLog';

const DOCS = 'docs/agents.md';

function Connection(props: {
  readonly state: AgentSessionState | null;
  readonly session: AgentSessionHandle | null;
  readonly unavailable: string | null;
}): JSX.Element {
  const { state, session } = props;
  const now = useNow(state?.status === 'offering');
  const [copied, setCopied] = useState(false);
  const status = state?.status ?? 'off';
  const connect = (): void => void session?.connect();
  if (status === 'off') {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-fg-2">No agent connected.</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" data-testid="agent-connect" disabled={session === null} onClick={connect}>
            Connect
          </Button>
          {props.unavailable === null ? null : <span className="text-fg-3">{props.unavailable}</span>}
        </div>
        <p className="text-fg-3">AI agents connect through the ekza-studio-mcp server ({DOCS}).</p>
      </div>
    );
  }
  if (status === 'probing') {
    return (
      <div className="flex items-center gap-2">
        <output className="text-fg-2">Looking for agents on this computer…</output>
        <Button size="sm" data-testid="agent-cancel" onClick={() => session?.cancel?.()}>
          Cancel
        </Button>
      </div>
    );
  }
  if (status === 'choosing') {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-fg-2">Choose the agent server to pair with:</p>
        {state?.servers.map((entry) => (
          <button
            type="button"
            key={entry.port}
            className="flex items-center gap-2 rounded border border-line px-2 py-1 text-left hover:enabled:bg-hover disabled:opacity-60"
            data-testid={`agent-server-${entry.port}`}
            disabled={entry.busy || session?.choose === undefined}
            onClick={() => session?.choose?.(entry.port)}
          >
            <span className="font-medium">{entry.client?.name ?? 'No agent yet'}</span>
            <span className="text-fg-3">
              {entry.server.name} {entry.server.version} · port {entry.port}
            </span>
            {entry.busy ? <span className="text-fg-3">connected to another tab</span> : null}
          </button>
        ))}
      </div>
    );
  }
  if (status === 'offering' || status === 'claimed') {
    const code = state?.code ?? null;
    const left = code === null ? 0 : Math.max(0, Math.ceil((code.expiresAt - now) / 1_000));
    return (
      <div className="flex flex-col gap-1.5">
        {status === 'claimed' ? (
          <p className="text-fg-2">An agent claimed the code: choose what it may do in the dialog.</p>
        ) : (
          <p className="text-fg-2">
            Tell your agent: <em>connect to my editor, code {code?.text ?? '…'}</em>
          </p>
        )}
        <div className="flex items-center gap-2">
          <code className="font-mono text-[32px] leading-none tracking-wider text-fg" data-testid="agent-code">
            {code?.text ?? '…'}
          </code>
          <Button
            size="sm"
            data-testid="agent-code-copy"
            disabled={code === null}
            onClick={() => {
              if (code === null) return;
              void navigator.clipboard?.writeText(code.text).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button size="sm" data-testid="agent-cancel" onClick={() => session?.cancel?.() ?? session?.disconnect()}>
            Cancel
          </Button>
        </div>
        {code === null ? null : <p className="text-fg-3 tabular-nums">The code expires in {left} s.</p>}
      </div>
    );
  }
  if (status === 'error') {
    const error = state?.error ?? null;
    return (
      <div className="flex flex-col gap-1.5" data-testid="agent-error">
        <p className="text-danger">{error?.message ?? 'The agent is not connected.'}</p>
        {error?.kind === 'lna_denied' ? (
          <p className="text-fg-3" data-testid="agent-lna-help">
            The browser blocked access to this computer’s local network. Allow “Local network access” for this site in
            the address bar’s site settings, then try again.
          </p>
        ) : null}
        <div>
          <Button size="sm" data-testid="agent-retry" onClick={connect}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  // paired, paused
  const server = state?.server ?? null;
  const paused = status === 'paused';
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex flex-wrap items-center gap-1.5 text-fg-2" data-testid="agent-status">
        <span
          aria-hidden
          className="inline-block size-2 rounded-full"
          style={{ background: 'var(--presence-agent, #e66cff)' }}
        />
        <span className="font-medium text-fg">{paused ? 'Paused' : 'Connected'}</span>
        {server?.client === null || server?.client === undefined ? null : (
          <span>· {server.client.name} (reported)</span>
        )}
        {server === null ? null : (
          <span className="text-fg-3">
            · {server.server.name} {server.server.version}
          </span>
        )}
      </p>
      <div className="flex gap-2">
        {paused ? (
          <Button
            size="sm"
            data-testid="agent-resume"
            disabled={session?.resume === undefined}
            onClick={() => session?.resume?.()}
          >
            Resume
          </Button>
        ) : (
          <Button
            size="sm"
            data-testid="agent-pause"
            disabled={session?.pause === undefined}
            onClick={() => session?.pause?.()}
          >
            Pause
          </Button>
        )}
        <Button size="sm" variant="danger" data-testid="agent-disconnect" onClick={() => session?.disconnect()}>
          Disconnect
        </Button>
      </div>
    </div>
  );
}

function Grants(props: { readonly state: AgentSessionState; readonly session: AgentSessionHandle }): JSX.Element {
  const grants = props.state.grants;
  const value = { edit: grants.edit, files: grants.files, workspace: grants.workspace, view: grants.view };
  return (
    <section className="flex flex-col gap-1" aria-label="Grants">
      <h3 className="text-ui-dense font-semibold tracking-wide text-fg-3 uppercase">Grants</h3>
      <GrantList
        dense
        value={value ?? DEFAULT_GRANTS}
        disabled={props.session.setGrants === undefined}
        onChange={(next) => props.session.setGrants?.(next)}
      />
    </section>
  );
}

function RevertAll(props: {
  readonly runtime: AgentRuntime;
  readonly state: AgentSessionState;
  readonly run: ReturnType<typeof useRunOperator>;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
  const targets = revertAllTargets(props.runtime, props.state.audit);
  if (asking && targets.length > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg-2" data-testid="agent-revert-all-question">
          Revert {targets.length} AI {targets.length === 1 ? 'step' : 'steps'}? Your own edits stay.
        </span>
        <Button size="sm" data-testid="agent-revert-all-cancel" onClick={() => setAsking(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="danger"
          data-testid="agent-revert-all-confirm"
          onClick={() => {
            setAsking(false);
            void revertAll(props.runtime, props.run, props.state.audit);
          }}
        >
          Revert
        </Button>
      </div>
    );
  }
  return (
    <Button size="sm" data-testid="agent-revert-all" disabled={targets.length === 0} onClick={() => setAsking(true)}>
      Revert all AI changes since pairing
    </Button>
  );
}

export default function AgentPanel(props: PanelProps): JSX.Element {
  const { runtime, state: rt } = useAgentRuntime(props.app);
  const state = useAgentSessionState(rt.session);
  const run = useRunOperator();
  // The live pill (and the confirm card, grants dialog and toasts it hosts) stays once the agent module loaded.
  useEffect(() => setAgentPill(<LivePill />), []);
  const live = state !== null && rt.session !== null && (state.status === 'paired' || state.status === 'paused');
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2 text-ui text-fg-2" data-testid="agent-panel">
      <Connection state={state} session={rt.session} unavailable={rt.unavailable} />
      {live && rt.session !== null && state !== null ? <Grants state={state} session={rt.session} /> : null}
      {state !== null && state.audit.length > 0 ? (
        <>
          <AuditLog app={props.app} runtime={runtime} state={state} run={run} />
          <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-1.5">
            <RevertAll runtime={runtime} state={state} run={run} />
          </footer>
        </>
      ) : null}
    </div>
  );
}
