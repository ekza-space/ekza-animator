// The live status-line pill (MCP-SPEC §7.5) and the agent UI that must show while the Agent panel is hidden: the
// confirm card (§7.4), the grants dialog after `pair.claimed` (§7.3) and the "AI is working on clip …" toast with
// [Show] (§5.11). Mounted in the status line's slot once the agent module loaded.
import { Tooltip } from '@ekza-studio/ui';
import { type JSX, useEffect, useMemo } from 'react';
import { useEditorApp } from '../../hooks';
import { useOptionalShell } from '../../shell/context';
import { ConfirmCard } from './ConfirmCard';
import { GrantsDialog } from './GrantsDialog';
import { useAgentRuntime, useAgentSessionState, useHistoryView } from './hooks';
import { pillView, toastRow } from './model';
import { AGENT_SHOW } from './show';

const TONE: Readonly<Record<string, string>> = {
  muted: 'text-fg-3',
  idle: 'text-fg',
  busy: 'text-fg bg-[color-mix(in_srgb,var(--presence-agent,#e66cff)_20%,transparent)]',
  error: 'text-danger',
};

export function LivePill(): JSX.Element {
  const app = useEditorApp();
  const shell = useOptionalShell();
  const { runtime, state: rt } = useAgentRuntime(app);
  const state = useAgentSessionState(rt.session);
  const history = useHistoryView(app);
  const activeClipOf = useMemo(
    () => (character: string) =>
      (app.session.getState().activeClip as Record<string, string | undefined>)[character] ?? null,
    [app],
  );
  const view = pillView(state, {
    activeClipOf,
    clipName: (clip) => app.store.get('clips', clip as never)?.name ?? null,
    userRedoSteps: history.redo.filter((step) => step.actor === undefined || step.actor === null).length,
  });

  // §5.11: the first edit of a clip the user is not looking at raises the toast with [Show], once per clip.
  const audit = state?.audit;
  useEffect(() => {
    if (audit === undefined) return;
    const row = toastRow(audit, runtime.store.getState().toasted, activeClipOf);
    if (row === null || row.show === null || !runtime.markToasted(row.show.clip)) return;
    const name = app.store.get('clips', row.show.clip)?.name ?? 'another clip';
    app.services.notify.toast({
      kind: 'info',
      text: `AI is working on clip "${name}"`,
      action: { label: 'Show', op: AGENT_SHOW, args: row.show },
    });
  }, [app, audit, runtime, activeClipOf]);

  const open = (): void => {
    if (shell !== null) void shell.runFromUi('workspace.showPanel', { panel: 'agent' });
  };
  return (
    <>
      <Tooltip content={view.text}>
        <button
          type="button"
          className={`max-w-[260px] truncate rounded px-1.5 text-ui hover:bg-hover hover:text-fg ${TONE[view.tone] ?? ''}`}
          data-testid="status-agent"
          data-state={state?.status ?? 'off'}
          onClick={open}
        >
          {view.text}
        </button>
      </Tooltip>
      {state !== null && rt.session !== null ? (
        <>
          <ConfirmCard state={state} session={rt.session} />
          <GrantsDialog state={state} session={rt.session} />
        </>
      ) : null}
    </>
  );
}
