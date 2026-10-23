// [Show] (MCP-SPEC §5.11; B3): the user's own click that brings the agent's work into view — the step's character and
// clip become active (`clip.setActive`) and the playhead moves to the step's focus frame (`time.setFrame`, clip
// units). It never changes the selection of the same character (clip.setActive keeps it). `agent.show` is the
// operator toasts and audit rows run; it is unclassified, so agents can never reach it (`operator_run` denies it).
// The 3 s outline of the touched controls belongs to presence drawing, deferred in the MVP (§0.4.2).
import type { Disposer } from '@ekza-studio/anim-core';
import type { CharacterId, ClipId, ControlId } from '@ekza-studio/doc';
import type { EditorApp, OperatorDef, RunContext } from '@ekza-studio/editor-core';

export interface AgentShowArgs {
  readonly character: CharacterId;
  readonly clip: ClipId;
  readonly frame: number | null;
  readonly controls?: readonly ControlId[];
}

export const AGENT_SHOW = 'agent.show';
const CTX: RunContext = { panel: 'agent', source: 'toolkit' };

function isShowArgs(args: unknown): args is AgentShowArgs {
  if (typeof args !== 'object' || args === null) return false;
  const value = args as Record<string, unknown>;
  return (
    typeof value['character'] === 'string' &&
    typeof value['clip'] === 'string' &&
    (value['frame'] === null || value['frame'] === undefined || typeof value['frame'] === 'number')
  );
}

/** Whether switching to `clip` would discard the user's unkeyed overrides on its character. */
export function showDiscardsOverrides(app: EditorApp, show: AgentShowArgs): boolean {
  const state = app.session.getState();
  if (state.activeClip[show.character] === show.clip) return false;
  const runtime = app.characters.get(show.character);
  if (runtime === undefined) return false;
  for (const control of state.overrides.keys()) if (runtime.program.controlIndex.has(control)) return true;
  return false;
}

/**
 * Shows an agent step: switches the clip (asking first when that drops unkeyed changes) and moves the playhead. Returns
 * false when the user kept their clip or the clip is gone.
 */
export async function showAgentStep(
  app: EditorApp,
  show: AgentShowArgs,
  ask: (text: string) => boolean = (text) => (typeof confirm === 'function' ? confirm(text) : true),
): Promise<boolean> {
  if (app.store.get('clips', show.clip) === undefined) return false;
  if (showDiscardsOverrides(app, show) && !ask('Showing another clip discards your unkeyed changes. Show anyway?')) {
    return false;
  }
  const state = app.session.getState();
  if (state.activeClip[show.character] !== show.clip || state.activeCharacter !== show.character) {
    const result = await app.runUntyped('clip.setActive', { clip: show.clip }, CTX);
    if (result.status !== 'finished') return false;
  }
  if (show.frame !== null && Number.isFinite(show.frame)) {
    await app.runUntyped('time.setFrame', { frame: show.frame, unit: 'clip' }, CTX);
  }
  return true;
}

/** Registers `agent.show` on the app (once); the disposer unregisters it. */
export function registerAgentShow(app: EditorApp): Disposer {
  if (app.operators.get(AGENT_SHOW) !== undefined) return () => {};
  const def: OperatorDef<AgentShowArgs> = {
    id: AGENT_SHOW,
    label: 'Show AI Change',
    description: "Show the clip and frame of the AI agent's change.",
    category: 'view',
    scope: 'global',
    flags: { internal: true },
    poll: (ctx, args) =>
      ctx.actor !== null && ctx.actor !== undefined
        ? { ok: false, reason: 'Showing an AI change is the user’s action' }
        : isShowArgs(args)
          ? true
          : { ok: false, reason: 'expects { character, clip, frame }' },
    apply(_ctx, args) {
      // The switch runs operators of its own: after this run, never nested inside it.
      queueMicrotask(() => void showAgentStep(app, args));
    },
  };
  return app.operators.register(def);
}
