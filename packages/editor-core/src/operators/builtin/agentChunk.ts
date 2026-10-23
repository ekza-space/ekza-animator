// M-AI (MCP-SPEC §4.10; MVP cut §0.4): the explicit-target operators are not part of the editor's first visit
// (`check:size`): their definitions load as one chunk on the first run of one of their ids (the runner's
// `lazyOperatorChunk`), or up front when an agent runtime or a headless app attaches (`loadAgentOperators`). Until
// then `operators.get(id)` is undefined and `operators.poll(id)` answers "unknown operator".
import type { EditorApp } from '../../types';
import { loadActorKit } from '../scope';

/** The ids `agentOperators.ts` registers. */
export const AGENT_OPERATOR_IDS: ReadonlySet<string> = new Set([
  'key.write',
  'key.delete',
  'key.adjust',
  'key.retime',
  'pose.setAt',
  'pose.goals',
  'pose.transfer',
  'clip.makeLoop',
  'edit.revertSteps',
  'edit.restoreDocument',
]);

const loads = new WeakMap<object, Promise<void>>();

/** Registers the explicit-target operators on this app once (ids already registered are left as they are) and loads
 *  the actor run helpers. */
export function loadAgentOperators(app: EditorApp): Promise<void> {
  const known = loads.get(app.operators);
  if (known !== undefined) return known;
  // M-AI B5: with the actor run helpers (`scope.ts`), so an agent's polls outside a run (the tool layer's scope probe)
  // find them loaded.
  const load = Promise.all([import('./agentOperators'), loadActorKit()]).then(([{ AGENT_OPERATORS }]) => {
    for (const def of AGENT_OPERATORS) {
      if (app.operators.get(def.id) === undefined) app.contribute({ kind: 'operator', def });
    }
  });
  loads.set(app.operators, load);
  load.catch(() => {
    if (loads.get(app.operators) === load) loads.delete(app.operators);
  });
  return load;
}
