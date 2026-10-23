// M-AI (MCP-SPEC §4.1 runner rules 2 and 6): the parts of the runner only actor (agent) runs use, a lazy chunk the
// runner loads on an actor run's first step, so the editor's first visit does not carry them (§0.4, `check:size`).
import { EkzaError } from '@ekza-studio/anim-core';
import type { Tx } from '@ekza-studio/doc';
import type { EditorApp } from '../types';
import { AI_LABEL_MAX, AI_LABEL_PREFIX } from './runner';

/** The actor side of the run-scope helpers (`scope.ts` installs it when this chunk loads, M-AI B5). */
export * as ACTOR_SCOPE from './actorScope';

/** Runner rule 2: `AI: <label>`, at most 80 characters (a label that already carries the prefix keeps it once). */
export function actorLabel(label: string): string {
  const full = label.startsWith(AI_LABEL_PREFIX) ? label : `${AI_LABEL_PREFIX}${label}`;
  return full.length <= AI_LABEL_MAX ? full : `${full.slice(0, AI_LABEL_MAX - 1)}…`;
}

/**
 * Runner rule 6: the session fields an actor run must leave as they were (by reference), M6a's included when the
 * session has them. `prefs` is compared as the whole preferences state object.
 */
export const AGENT_PROTECTED_SESSION_FIELDS = [
  'selection',
  'time',
  'overrides',
  'activeCharacter',
  'activeClip',
  'tools',
  'clipboard',
  'curveBuffers',
  'hiddenControls',
  'showSecondary',
  'viewportLayout',
  'maximizedPane',
  'dialog',
  'feetPins',
  // M6a (present once its session fields land)
  'workspace',
  'model',
  'workspaceViews',
  // M6b (Rig & Skin session: mode, test pose, Quick Rig markers)
  'rig',
] as const;

export interface SessionRecord {
  readonly fields: ReadonlyMap<string, unknown>;
  readonly prefs: unknown;
}

export function recordSession(app: EditorApp): SessionRecord {
  const state = app.session.getState() as unknown as Readonly<Record<string, unknown>>;
  const fields = new Map<string, unknown>();
  for (const field of AGENT_PROTECTED_SESSION_FIELDS) if (field in state) fields.set(field, state[field]);
  return { fields, prefs: app.prefs.getState() };
}

/** Throws `agent-ustate` when an actor run changed a protected session field or the preferences. */
export function checkSession(app: EditorApp, id: string, recorded: SessionRecord): void {
  const state = app.session.getState() as unknown as Readonly<Record<string, unknown>>;
  for (const [field, value] of recorded.fields) {
    if (state[field] !== value) {
      throw new EkzaError('agent-ustate', `${id} changed session.${field} during an agent run`);
    }
  }
  if (app.prefs.getState() !== recorded.prefs) {
    throw new EkzaError('agent-ustate', `${id} changed the preferences during an agent run`);
  }
}

/** Runner rule 2: a view of `tx` whose `annotate({label})` adds the actor prefix. */
export function actorTx(tx: Tx): Tx {
  const annotate: Tx['annotate'] = (meta) =>
    tx.annotate(meta.label === undefined ? meta : { ...meta, label: actorLabel(meta.label) });
  return new Proxy(tx, {
    get(target, prop) {
      if (prop === 'annotate') return annotate;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
