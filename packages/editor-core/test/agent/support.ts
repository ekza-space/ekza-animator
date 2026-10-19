// Helpers of the M-AI operator tests (MCP-SPEC §8 P1): agent runs on the wave fixture app, a simulated user session
// (selection, band, override, another active clip) whose protected fields must stay as they were, and the
// undo/redo-exactness check of §6.3 for agent runs.
import type { ClipId, ControlId, CurveId, KeyId } from '@ekza-animator/doc';
import { expect } from 'vitest';
import { AGENT_PROTECTED_SESSION_FIELDS } from '../../src';
import type { FakeEditorApp } from '../../src/testing';
import type { EditorApp, OperatorResult, RunActor, RunContext, RunScope } from '../../src/types';
import { DEG, docJson, opsApp, runOk, WAVE } from '../builtin/support';

export { DEG, docJson, opsApp, runOk, WAVE };

export const AGENT: RunActor = { kind: 'agent', id: 'agt_P1OperatorTest', name: 'P1 Test' };

/** The run context of an agent edit (§5.6: source 'api', the actor, the resolved access). */
export function asAgent(opts?: { readonly runScope?: RunScope; readonly access?: 'edit' | 'view' }): RunContext {
  return {
    source: 'api',
    actor: AGENT,
    access: opts?.access ?? 'edit',
    ...(opts?.runScope === undefined ? {} : { runScope: opts.runScope }),
  };
}

export function runAgent(
  app: EditorApp,
  id: string,
  args: unknown,
  ctx: RunContext = asAgent(),
): Promise<OperatorResult<unknown>> {
  return app.runUntyped(id, args, ctx);
}

/** Runs as the agent and expects it to finish; returns its value. */
export async function agentOk(
  app: EditorApp,
  id: string,
  args: unknown,
  ctx: RunContext = asAgent(),
): Promise<unknown> {
  const result = await runAgent(app, id, args, ctx);
  if (result.status !== 'finished') throw new Error(`${id} did not finish: ${JSON.stringify(result)}`);
  return result.value;
}

/** The poll reason of a refused agent run (fails the test when the run finishes). */
export async function agentRefusal(
  app: EditorApp,
  id: string,
  args: unknown,
  ctx: RunContext = asAgent(),
): Promise<string> {
  const result = await runAgent(app, id, args, ctx);
  if (result.status !== 'cancelled') throw new Error(`${id} was not refused: ${JSON.stringify(result)}`);
  return result.reason;
}

/** The protected session fields (§4.1 runner rule 6) and the preferences, by reference. */
export function sessionRecord(app: EditorApp): unknown[] {
  const state = app.session.getState() as unknown as Readonly<Record<string, unknown>>;
  return [...AGENT_PROTECTED_SESSION_FIELDS.map((field) => state[field]), app.prefs.getState()];
}

/** Fields that changed between two records (names; 'prefs' for the preferences). */
export function changedFields(before: readonly unknown[], after: readonly unknown[]): string[] {
  const names = [...AGENT_PROTECTED_SESSION_FIELDS, 'prefs'];
  return names.filter((_, i) => before[i] !== after[i]);
}

/** A second, empty clip of the wave character (the user's active clip in the session tests). */
export async function userClip(app: FakeEditorApp): Promise<ClipId> {
  const { clip } = (await runOk(app, 'clip.new', {
    character: WAVE.character,
    name: 'user',
    range: { start: 0, end: 30 },
  })) as { readonly clip: ClipId };
  return clip;
}

/**
 * The simulated user (§5.14 second D0 test): a selection with a control and a key, a band, an override on fk.hand.L,
 * frame 12 of the wave clip.
 */
export function seedUser(app: EditorApp): void {
  const state = app.session.getState();
  app.session.setState({
    selection: {
      ...state.selection,
      controls: [WAVE.upperArmL],
      keys: new Map([[WAVE.keys[1], { key: true, in: false, out: false }]]),
    },
    time: { ...state.time, sceneFrame: 12, band: { start: 5, end: 10 } },
  });
  // After the frame change (the kernel drops overrides when the clip frame moves).
  app.session.setState({ overrides: new Map([[WAVE.handL, { rx: 10 * DEG }]]) });
}

/** Keys of a curve as [t, v] pairs (rounded). */
export function keysOf(app: EditorApp, curve: CurveId | undefined): [number, number][] {
  if (curve === undefined) return [];
  return app.store.query.keysOfCurve(curve).map((key) => [key.t, Math.round(key.v * 1e9) / 1e9]);
}

/** The wave clip's base curve of a control channel. */
export function waveCurve(
  app: EditorApp,
  control: ControlId,
  channel: string,
  clip: ClipId = WAVE.clip,
): CurveId | undefined {
  const layer = app.store.query.baseLayer(clip);
  return layer === undefined ? undefined : app.store.query.curveFor(clip, layer.id, control, channel as never)?.id;
}

/**
 * §6.3 for an agent run: one history step labelled `AI: …`, carrying the actor; one undo (the user's `Mod+Z`)
 * reverts the document exactly, one redo replays it exactly; the session record is unchanged throughout.
 */
export async function expectAgentUndoRedoExact(
  app: EditorApp,
  id: string,
  args: unknown,
  ctx: RunContext = asAgent(),
): Promise<{ readonly value: unknown; readonly before: unknown; readonly after: unknown }> {
  const session = sessionRecord(app);
  const before = docJson(app);
  const top = app.history.peekUndo()?.id;
  const value = await agentOk(app, id, args, ctx);
  const after = docJson(app);
  expect(after).not.toEqual(before);
  const step = app.history.peekUndo();
  expect(step?.id).not.toBe(top);
  expect(step?.label.startsWith('AI: ')).toBe(true);
  expect(step?.actor).toEqual(AGENT);
  expect(changedFields(session, sessionRecord(app))).toEqual([]);
  expect((await app.runUntyped('edit.undo')).status).toBe('finished');
  expect(docJson(app)).toEqual(before);
  expect((await app.runUntyped('edit.redo')).status).toBe('finished');
  expect(docJson(app)).toEqual(after);
  return { value, before, after };
}

export type { KeyId };
