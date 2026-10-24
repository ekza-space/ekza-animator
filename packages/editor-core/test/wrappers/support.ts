// Helpers of the UI wrapper tests (STUDIO-TOUCH-SPEC §20.3 item 7, T5a): the wave fixture app and a headless Polybot
// (the real kernel and rig, IK limbs and a head) with the wrappers loaded, and the checks every wrapper run meets: one
// history step under its label, an exact undo and redo, never a Repeat Last or Adjust Last run.
import type { CharacterId, ClipId, ControlId } from '@ekza-studio/doc';
import { seededIdSource } from '@ekza-studio/doc';
import { readFixture } from '@ekza-studio/doc/testing';
import { expect } from 'vitest';
import { createHeadlessEditorApp, type ImportResult, loadUiWrappers, type SampleDef } from '../../src';
import type { EditorApp, OperatorResult } from '../../src/types';
import { docJson, opsApp, runOk } from '../builtin/support';

export { DEG, docJson, opsApp, runOk, setSceneFrame, WAVE } from '../builtin/support';

/** The wave fixture app with the wrappers registered. */
export async function waveApp(): Promise<EditorApp> {
  const app = opsApp();
  await loadUiWrappers(app);
  return app;
}

function readSample(sample: SampleDef): Promise<Uint8Array> {
  return Promise.resolve(readFixture(sample.file as 'polybot.vrm' | 'seed-san.vrm' | 'quaternius-ual.glb'));
}

function runtimeReady(app: EditorApp, character: CharacterId): Promise<void> {
  if (app.characters.get(character) !== undefined) return Promise.resolve();
  return new Promise((resolve) => {
    const off = app.characters.subscribe(() => {
      if (app.characters.get(character) === undefined) return;
      off();
      resolve();
    });
  });
}

export interface Polybot {
  readonly app: EditorApp;
  readonly character: CharacterId;
  readonly clip: ClipId;
}

/** Headless Polybot with an active 0…30 clip at frame 10 and the wrappers registered. */
export async function polybot(): Promise<Polybot> {
  const app = createHeadlessEditorApp({ readSample, idSource: seededIdSource(7) });
  const { character } = (await runOk(app, 'file.loadSample', { sample: 'polybot' })) as ImportResult;
  await runtimeReady(app, character);
  const { clip } = (await runOk(app, 'clip.new', { character, name: 'reach', range: { start: 0, end: 30 } })) as {
    readonly clip: ClipId;
  };
  app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 10 } });
  await loadUiWrappers(app);
  return { app, character, clip };
}

export function controlOf(app: EditorApp, character: CharacterId, key: string): ControlId {
  const rig = app.store.query.rigOfCharacter(character);
  const control = rig === undefined ? undefined : app.store.query.controlByKey(rig.id, key);
  if (control === undefined) throw new Error(`no control ${key}`);
  return control.id;
}

export function select(app: EditorApp, controls: readonly ControlId[]): void {
  const state = app.session.getState();
  app.session.setState({ selection: { ...state.selection, controls } });
}

/** The poll reason of a refused run (fails the test when the run finishes). */
export async function refusal(app: EditorApp, id: string, args?: unknown, ctx?: object): Promise<string> {
  const result: OperatorResult<unknown> = await app.runUntyped(id, args, ctx);
  if (result.status === 'finished') throw new Error(`${id} was not refused`);
  return result.status === 'cancelled' ? result.reason : result.error.message;
}

/**
 * A wrapper run as the user: one new history step under `label`, an exact undo and redo of the document, and no
 * Repeat Last / Adjust Last record (the wrappers declare no ParamDefs, §20.3 item 6).
 */
export async function expectOneStep(
  app: EditorApp,
  id: string,
  args: unknown,
  label: string,
): Promise<{ readonly value: unknown; readonly before: unknown; readonly after: unknown }> {
  const before = docJson(app);
  const steps = app.history.entries().undo.length;
  const value = await runOk(app, id, args);
  const after = docJson(app);
  expect(app.history.entries().undo.length).toBe(steps + 1);
  expect(app.history.peekUndo()?.label).toBe(label);
  expect(app.session.getState().lastRun?.id === id).toBe(false);
  expect((await app.runUntyped('edit.undo')).status).toBe('finished');
  expect(docJson(app)).toEqual(before);
  expect((await app.runUntyped('edit.redo')).status).toBe('finished');
  expect(docJson(app)).toEqual(after);
  return { value, before, after };
}
