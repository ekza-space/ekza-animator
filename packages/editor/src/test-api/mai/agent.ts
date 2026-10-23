// M-AI test API slice (MCP-SPEC §4.9): `agent()` — the agent session as plain data, null while no session exists (the
// agent module is a lazy chunk: reading the slot loads nothing); `agentAct()` — what the user does in the Agent panel
// (B2, M-AI-B2-3); and `?agentPort=` in e2e pages opened with `?e2e=1`: the session connects at start (§4.9).
import type { EditorApp } from '@ekza-studio/editor-core';
import { agentSessionOf, loadAgentSession } from '../../agent/bridge/slot';
import type { AgentSession } from '../../agent/session';
import type { HostShell } from '../../host/types';
import { parseAgentParams } from '../agentParams';
import type { EkzaStudioTestApi } from '../types';

type AgentView = NonNullable<ReturnType<EkzaStudioTestApi['agent']>>;

export function agentStateOf(app: EditorApp): ReturnType<EkzaStudioTestApi['agent']> {
  const session = agentSessionOf(app);
  if (session === null) return null;
  const state = session.store.getState();
  const peer = state.actor === null ? undefined : app.presence.get(state.actor.id);
  const view: AgentView = {
    status: state.status,
    port: state.server?.port ?? null,
    client: state.server?.client?.name ?? null,
    code: state.code?.text ?? null,
    grants: { ...state.grants },
    queue: { ...state.queue },
    confirm: state.confirm === null ? null : { id: state.confirm.id, title: state.confirm.prompt.title },
    audit: state.audit.map((row) => ({
      n: row.n,
      tool: row.tool,
      status: row.status,
      code: row.code,
      step: row.step?.id ?? null,
      label: row.step?.label ?? null,
      reverted: row.reverted,
      unreachable: row.unreachable,
      group: row.group,
    })),
    checkpoints: state.checkpoints.map((cp) => ({ id: cp.id, label: cp.label, stepId: cp.stepId })),
    beforeAgent: state.beforeAgent !== null,
    presence:
      peer === undefined
        ? null
        : { controls: [...(peer.focus?.controls ?? [])], frame: peer.focus?.frame ?? null, activity: peer.activity },
  };
  return view;
}

function sessionFor(app: EditorApp, host: HostShell | null): Promise<AgentSession> {
  const params = parseAgentParams(globalThis.location?.search ?? '', true);
  return loadAgentSession(app, {
    viewport: () => host?.ui.getState().viewport ?? null,
    params: {
      agentPorts: params.agentPorts,
      ...(params.gestureWaitMs === null ? {} : { gestureWaitMs: params.gestureWaitMs }),
      ...(params.confirmTimeoutMs === null ? {} : { confirmTimeoutMs: params.confirmTimeoutMs }),
    },
    build: 'e2e',
  });
}

/** `?e2e=1&agentPort=<port>`: the session loads and connects at start (§4.9). */
export function startAgentFromParams(app: EditorApp, host: HostShell): void {
  const params = parseAgentParams(globalThis.location?.search ?? '', true);
  if (!params.connectAtStart) return;
  void sessionFor(app, host).then((session) => session.connect());
}

export async function agentActOf(
  app: EditorApp,
  host: HostShell | null,
  action: Parameters<EkzaStudioTestApi['agentAct']>[0],
  grants: Parameters<EkzaStudioTestApi['agentAct']>[1],
): Promise<void> {
  const session = action === 'connect' ? await sessionFor(app, host) : agentSessionOf(app);
  if (session === null) throw new Error(`agentAct('${action}'): no agent session`);
  const state = session.store.getState();
  switch (action) {
    case 'connect':
      await session.connect();
      return;
    case 'accept':
      session.accept({
        read: true,
        edit: grants?.edit ?? state.grants.edit,
        files: grants?.files ?? state.grants.files,
        view: grants?.view ?? state.grants.view,
        workspace: grants?.workspace ?? state.grants.workspace,
      });
      return;
    case 'deny':
      session.deny();
      return;
    case 'pause':
    case 'resume':
      session.setPaused(action === 'pause');
      return;
    case 'allowConfirm':
    case 'denyConfirm':
      if (state.confirm === null) throw new Error(`agentAct('${action}'): no confirm card`);
      session.answerConfirm(state.confirm.id, action === 'allowConfirm' ? 'allow' : 'deny');
      return;
    case 'disconnect':
      session.disconnect();
      return;
  }
}
