// The Ask sheet (STUDIO-TOUCH-SPEC §14, §8 *Ask AI*, J8; T10): Halo's touch view over the page's AI agent session —
// the agent module (`@ekza-studio/editor/agent`, a lazy chunk) is read, never restyled: the request asked from search,
// the connection (Connect, the pairing code, Pause / Resume, Disconnect), the pairing card with plain grants (*change my
// animation* = Edit, *save files* = Files with *use my agent's workspace folder* = Workspace folder under it, *change
// what I see* = View; Read always), the agent's confirm prompts inline, a live activity line, and the agent's latest
// group of steps (*"AI · Wave twice · 5 steps"*: Undo all, Compare, Steps ▾ → History), with *Take back every AI
// change* and *Restore the project as it was before the AI*. Safari (iPad and macOS) cannot reach the agent's loopback
// bridge, so there the sheet says the assistant runs on a computer for now and offers the recipes (§15.0, OQ-5).
import type * as AgentApi from '@ekza-studio/editor/agent';
import type { AgentRuntime, AgentSessionHandle, AgentSessionState } from '@ekza-studio/editor/agent';
import { Sheet, SheetGroup, SheetRow, ToggleChip, TouchButton } from '@ekza-studio/ui/touch';
import { type JSX, useEffect, useRef, useState } from 'react';
import { en } from '../../i18n/en';
import type { HaloSheetProps } from '../../manifest/sheets';
import { matchRecipes, SEARCH_RECIPES } from '../../recipes';
import { revertSteps, type Run } from '../history/actions';
import { AiGroupCard } from '../history/AiGroupCard';
import { type HistoryRow, historyRows } from '../history/model';
import { beforeAgentOf, keepBeforeAgent, recordRequest, requestsOf } from '../history/requests';

const a = en.ask;

type AgentModule = typeof AgentApi;

/** Safari and every iPad browser (WebKit without Chrome or Edge): no loopback bridge from an https page (§14). */
export function computerOnly(userAgent: string): boolean {
  return /AppleWebKit/.test(userAgent) && !/Chrome|Chromium|CriOS|EdgiOS|Edg\//.test(userAgent);
}

/** The agent module's runtime, its session and the session's state, followed live. */
function useAgent(
  app: object,
  module: AgentModule | null,
): {
  readonly runtime: AgentRuntime | null;
  readonly session: AgentSessionHandle | null;
  readonly state: AgentSessionState | null;
} {
  const [, setTick] = useState(0);
  const runtime = module === null ? null : module.agentRuntimeOf(app as never);
  const session = runtime?.store.getState().session ?? null;
  useEffect(() => {
    if (runtime === null) return undefined;
    return runtime.store.subscribe(() => setTick((n) => n + 1));
  }, [runtime]);
  useEffect(() => {
    if (session === null) return undefined;
    return session.store.subscribe(() => setTick((n) => n + 1));
  }, [session]);
  return { runtime, session, state: session?.store.getState() ?? null };
}

export default function AskSheet({ ctx, args }: HaloSheetProps): JSX.Element {
  const app = ctx.host.app;
  const query = args?.query?.trim() ?? '';
  const onComputer = typeof navigator === 'undefined' || !computerOnly(navigator.userAgent);
  const [module, setModule] = useState<AgentModule | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, setHistoryTick] = useState(0);
  const [grants, setGrants] = useState({ edit: true, files: false, workspace: false, view: false });
  const run: Run = (op, runArgs) => ctx.run(op, runArgs);
  const touch = (): void => ctx.touch?.();
  const recorded = useRef(false);

  useEffect(() => {
    if (query !== '' && !recorded.current) {
      recorded.current = true;
      recordRequest(app, query);
    }
  }, [app, query]);
  useEffect(() => {
    if (!onComputer) return undefined;
    let alive = true;
    void import('@ekza-studio/editor/agent').then(
      (loaded) => {
        if (alive) setModule(loaded);
      },
      () => setNote(en.toast.chunkFailed),
    );
    return () => {
      alive = false;
    };
  }, [onComputer]);
  useEffect(() => app.history.subscribe(() => setHistoryTick((n) => n + 1)), [app]);
  const { runtime, session, state } = useAgent(app, module);

  const close = (): void => ctx.close();
  const status = state?.status ?? 'off';
  const client = state?.server?.client?.name ?? session?.extra?.getState().claim?.client?.name ?? 'Your agent';
  const rows = historyRows(app.history.entries(), requestsOf(app));
  const group = rows.find((row): row is Extract<HistoryRow, { kind: 'ai' }> => row.kind === 'ai') ?? null;
  const offers =
    query === ''
      ? []
      : matchRecipes(SEARCH_RECIPES, query).length > 0
        ? matchRecipes(SEARCH_RECIPES, query)
        : matchRecipes(SEARCH_RECIPES, 'wave');

  const activity = (): string => {
    if (state === null || module === null) return a.idle;
    const view = module.pillView(state, {
      activeClipOf: (character) =>
        (app.session.getState().activeClip as Record<string, string | undefined>)[character] ?? null,
      clipName: (clip) => app.store.get('clips', clip as never)?.name ?? null,
      userRedoSteps: 0,
    });
    return view.tone === 'busy' ? view.text : status === 'paired' ? a.idle : view.text;
  };

  const body = (): JSX.Element => {
    if (!onComputer) {
      return (
        <div className="flex flex-col gap-2" data-testid="halo-ask-computer-only">
          <p className="m-0 font-medium text-fg">{a.computerOnly}</p>
          <p className="m-0 text-fg-2">{a.computerOnlyHelp}</p>
          <SheetGroup>{a.recipes}</SheetGroup>
          {(offers.length > 0 ? offers : matchRecipes(SEARCH_RECIPES, 'wave')).map((offer) => (
            <SheetRow
              key={offer.id}
              title={offer.title}
              detail={offer.detail}
              onClick={() => {
                touch();
                close();
                void offer.run({ app, run, toast: (toast) => setNote(toast.text) });
              }}
            />
          ))}
        </div>
      );
    }
    if (module === null || runtime === null) return <p className="m-0 text-fg-3">{en.palette.loading}</p>;
    if (session === null)
      return <p className="m-0 text-fg-2">{runtime.store.getState().unavailable ?? a.connectHelp}</p>;
    switch (status) {
      case 'off':
        return (
          <div className="flex flex-col gap-2" data-testid="halo-ask-off">
            <p className="m-0 text-fg-2">{a.connectHelp}</p>
            <TouchButton
              variant="primary"
              data-testid="halo-ask-connect"
              onClick={() => {
                touch();
                void session.connect();
              }}
            >
              {a.connect}
            </TouchButton>
          </div>
        );
      case 'probing':
      case 'choosing':
        return (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-fg-2">{a.looking}</p>
            {state?.servers.map((entry) => (
              <SheetRow
                key={entry.port}
                title={entry.client?.name ?? entry.server.name}
                detail={`${entry.server.name} ${entry.server.version} · ${entry.port}`}
                disabled={entry.busy || session.select === undefined}
                onClick={() => {
                  touch();
                  session.select?.(entry.port);
                }}
              />
            ))}
            <TouchButton onClick={() => session.cancel?.()}>{a.cancel}</TouchButton>
          </div>
        );
      case 'offering':
        return (
          <div className="flex flex-col gap-2" data-testid="halo-ask-code">
            <p className="m-0 text-fg-2">{a.code}</p>
            <code
              className="font-mono text-[32px] leading-none tracking-wider text-fg"
              data-testid="halo-ask-code-text"
            >
              {state?.code?.text ?? '…'}
            </code>
            <p className="m-0 text-fg-3">{a.codeHelp(state?.code?.text ?? '…')}</p>
            <TouchButton onClick={() => session.cancel?.()}>{a.cancel}</TouchButton>
          </div>
        );
      case 'claimed':
        return (
          <div className="flex flex-col gap-2" data-testid="halo-ask-pairing">
            <p className="m-0 font-medium text-fg">{a.claimed(client)}</p>
            <SheetGroup>{a.grants}</SheetGroup>
            <div className="flex flex-col items-start gap-1.5">
              <ToggleChip
                label={a.grantEdit}
                pressed={grants.edit}
                data-testid="halo-ask-grant-edit"
                onPressedChange={(edit) => setGrants((g) => ({ ...g, edit }))}
              />
              <ToggleChip
                label={a.grantFiles}
                pressed={grants.files}
                data-testid="halo-ask-grant-files"
                onPressedChange={(files) => setGrants((g) => ({ ...g, files, workspace: files && g.workspace }))}
              />
              <ToggleChip
                label={a.grantWorkspace}
                pressed={grants.workspace}
                disabled={!grants.files}
                className="ml-6"
                data-testid="halo-ask-grant-workspace"
                onPressedChange={(workspace) => setGrants((g) => ({ ...g, workspace }))}
              />
              <ToggleChip
                label={a.grantView}
                pressed={grants.view}
                data-testid="halo-ask-grant-view"
                onPressedChange={(view) => setGrants((g) => ({ ...g, view }))}
              />
            </div>
            <div className="flex gap-2">
              <TouchButton
                variant="primary"
                data-testid="halo-ask-allow"
                disabled={session.accept === undefined}
                onClick={() => {
                  touch();
                  // the project as it is now: *Restore the project as it was before the AI* returns to it
                  keepBeforeAgent(app, app.store.snapshot());
                  session.accept?.({ ...grants, read: true, workspace: grants.files && grants.workspace });
                }}
              >
                {a.allow}
              </TouchButton>
              <TouchButton data-testid="halo-ask-deny" onClick={() => session.deny?.()}>
                {a.deny}
              </TouchButton>
            </div>
          </div>
        );
      case 'error':
        return (
          <div className="flex flex-col gap-2" data-testid="halo-ask-error">
            <p className="m-0 text-danger">{state?.error?.message ?? a.connectHelp}</p>
            <TouchButton onClick={() => void session.connect()}>{a.retry}</TouchButton>
          </div>
        );
      case 'paired':
      case 'paused': {
        const paused = status === 'paused';
        const before = beforeAgentOf(app);
        const confirm = state?.confirm ?? null;
        return (
          <div className="flex flex-col gap-2" data-testid="halo-ask-connected">
            <p className="m-0 flex flex-wrap items-center gap-2 text-fg">
              <span aria-hidden className="inline-block size-2 rounded-full bg-(--presence-agent,#e66cff)" />
              {paused ? a.paused : a.connected(client)}
            </p>
            <output className="text-fg-2" data-testid="halo-ask-activity">
              {activity()}
            </output>
            {confirm === null ? null : (
              <section
                className="flex flex-col gap-1.5 rounded-touch-card border border-line-strong p-2"
                aria-label={confirm.prompt.title}
                data-testid="halo-ask-confirm"
              >
                <strong className="text-fg">
                  {a.confirm}: {confirm.prompt.title}
                </strong>
                <p className="m-0 text-fg-2">{confirm.prompt.detail}</p>
                <div className="flex gap-2">
                  <TouchButton variant="primary" onClick={() => session.answerConfirm?.(confirm.id, 'allow')}>
                    {a.allow}
                  </TouchButton>
                  <TouchButton onClick={() => session.answerConfirm?.(confirm.id, 'deny')}>{a.deny}</TouchButton>
                </div>
              </section>
            )}
            {group === null ? null : (
              <AiGroupCard app={app} run={run} row={group} touch={touch} steps={() => ctx.open('history')} />
            )}
            <div className="flex flex-wrap gap-2">
              <TouchButton
                data-testid="halo-ask-pause"
                disabled={session.setPaused === undefined}
                onClick={() => session.setPaused?.(!paused)}
              >
                {paused ? a.resume : a.pause}
              </TouchButton>
              <TouchButton data-testid="halo-ask-disconnect" onClick={() => session.disconnect()}>
                {a.disconnect}
              </TouchButton>
            </div>
            <SheetGroup>{a.revertAll}</SheetGroup>
            <SheetRow
              title={a.revertAll}
              detail={group === null ? '' : en.history.group(group.title, group.steps.length)}
              disabled={group === null}
              onClick={() => {
                touch();
                const ids = rows.flatMap((row) => (row.kind === 'ai' ? row.steps.map((s) => s.id) : []));
                void revertSteps(run, ids);
              }}
            />
            <SheetRow
              title={a.restore}
              detail={before === null ? a.restoreReason : ''}
              disabled={before === null}
              onClick={() => {
                if (before === null) return;
                touch();
                void run('edit.restoreDocument', { snapshot: before.snapshot, label: a.restoreLabel });
              }}
            />
          </div>
        );
      }
    }
  };

  return (
    <Sheet
      data-testid="halo-sheet-ask"
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
      modal={false}
      side={ctx.side}
      defaultDetent={ctx.compact === true ? 'full' : 'half'}
      title={en.sheets['ask'] ?? 'Ask AI'}
    >
      {query === '' ? null : (
        <section className="flex flex-col gap-1 pb-2" data-testid="halo-ask-request">
          <SheetGroup>{a.request}</SheetGroup>
          <p className="m-0 text-touch font-medium text-fg">“{query}”</p>
          {onComputer ? <p className="m-0 text-touch-label text-fg-3">{a.requestHelp}</p> : null}
          {onComputer ? (
            <TouchButton
              variant="ghost"
              className="self-start"
              onClick={() =>
                void navigator.clipboard?.writeText(query).then(
                  () => setNote(a.copied),
                  () => undefined,
                )
              }
            >
              {a.copy}
            </TouchButton>
          ) : null}
        </section>
      )}
      {note === null ? null : <output className="block py-1 text-touch-label text-fg-2">{note}</output>}
      {body()}
    </Sheet>
  );
}
