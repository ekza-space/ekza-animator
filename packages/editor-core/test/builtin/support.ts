// Helpers of the built-in operator tests: the wave fixture app (the real kernel over the shared test kit) with the
// built-in operators registered, probes for the sibling packages the operators call (tests that need an
// implementation skip with the blocking WP in their title until it merges, MVP-SPEC §8.1), and the
// undo/redo-exactness check of §6.3.
import {
  type AnimCurve,
  curveEngine,
  EkzaError,
  eulerFilterCurves,
  reduceKeys,
  tangentFields,
} from '@ekza-studio/anim-core';
import { type DocSnapshot, emptySnapshot, fractionalIndex } from '@ekza-studio/doc';
import { checkInputBudget, parseGlb, readVrmLicense } from '@ekza-studio/io';
import { applyPoseClipboard, isHumanoidProgram, mirrorPose, plantFeetChannels } from '@ekza-studio/rig';
import { expect } from 'vitest';
import { registerBuiltinOperators } from '../../src';
import { createFakeEditorApp, createFakeServices, type FakeEditorApp, type FakeServices } from '../../src/testing';
import type { EditorApp, OperatorResult } from '../../src/types';
import { humanoidSkeleton, waveDoc } from '../testing/fixtures';

export { DEG, humanoidSkeleton, restPose, WAVE, waveDoc } from '../testing/fixtures';

/** True unless the call throws the sibling package's WP-0a stub error. */
export function implemented(probe: () => unknown): boolean {
  try {
    const result = probe();
    // An async implementation rejects on the probe's bad input: keep that rejection handled.
    if (result instanceof Promise) result.catch(() => {});
    return true;
  } catch (error) {
    return !(error instanceof EkzaError && error.code === 'not-implemented');
  }
}

const EMPTY_CURVE: AnimCurve = { keys: [], weighted: false, pre: 'constant', post: 'constant' };

/** Which sibling implementations are merged (each name is the work package that lands it). */
export const READY = {
  /** anim-core curve engine, tangent fields, Euler filter, reduction. */
  wp1:
    implemented(() => curveEngine.compile(EMPTY_CURVE)) &&
    implemented(() => tangentFields({ dt: 1, dv: 0 }, 'out', { num: 30, den: 1 }, 1)) &&
    implemented(() => eulerFilterCurves([EMPTY_CURVE, EMPTY_CURVE, EMPTY_CURVE], 'xyz')) &&
    implemented(() => reduceKeys(EMPTY_CURVE, { tolerance: 1 })),
  /** doc fractional indexing, snapshots. */
  wp2: implemented(() => fractionalIndex(null, null)) && implemented(() => emptySnapshot()),
  /** rig mirror, pose clipboard, plant feet. */
  wp3:
    implemented(() => isHumanoidProgram(undefined as never)) &&
    implemented(() => mirrorPose(undefined as never, new Map(), 'flip', null)) &&
    implemented(() => applyPoseClipboard(undefined as never, undefined as never, 'local')) &&
    implemented(() => plantFeetChannels(undefined as never, undefined as never, [], new Map())),
  /** io readers and checks. */
  wp4:
    implemented(() => parseGlb(new Uint8Array(0))) &&
    implemented(() => checkInputBudget(undefined as never)) &&
    implemented(() => readVrmLicense(undefined as never)),
} as const;

/** The wave fixture app (fake kernel over the naive kit) with every built-in operator registered. */
export function opsApp(opts?: { readonly snapshot?: DocSnapshot; readonly services?: FakeServices }): FakeEditorApp {
  return opsAppWith(opts).app;
}

/** `opsApp` with its recording services (downloads, toasts, clipboard). */
export function opsAppWith(opts?: { readonly snapshot?: DocSnapshot; readonly services?: FakeServices }): {
  readonly app: FakeEditorApp;
  readonly services: FakeServices;
} {
  const services = opts?.services ?? createFakeServices();
  const app = createFakeEditorApp({ snapshot: opts?.snapshot ?? waveDoc(), skeleton: humanoidSkeleton(), services });
  registerBuiltinOperators(app);
  return { app, services };
}

/** Runs an operator and expects it to finish; returns its value. */
export async function runOk(app: EditorApp, id: string, args?: unknown): Promise<unknown> {
  const result = await app.runUntyped(id, args);
  if (result.status !== 'finished') {
    throw new Error(`${id} did not finish: ${JSON.stringify(result)}`);
  }
  return result.value;
}

export async function runResult(app: EditorApp, id: string, args?: unknown): Promise<OperatorResult<unknown>> {
  return app.runUntyped(id, args);
}

/** The committed document as plain JSON (deep-equality of snapshots). */
export function docJson(app: EditorApp): unknown {
  return JSON.parse(JSON.stringify(app.store.snapshot())) as unknown;
}

/**
 * §6.3: an undoable operator reverts exactly on one undo and redoes exactly on one redo (document snapshots
 * deep-equal), and makes exactly one history step.
 */
export async function expectUndoRedoExact(
  app: EditorApp,
  id: string,
  args?: unknown,
): Promise<{ readonly before: unknown; readonly after: unknown; readonly value: unknown }> {
  const before = docJson(app);
  const steps = app.history.canUndo() ? app.history.peekUndo()?.id : null;
  const value = await runOk(app, id, args);
  const after = docJson(app);
  expect(after).not.toEqual(before);
  expect(app.history.peekUndo()?.id).not.toBe(steps);
  expect((await app.runUntyped('edit.undo')).status).toBe('finished');
  expect(docJson(app)).toEqual(before);
  expect((await app.runUntyped('edit.redo')).status).toBe('finished');
  expect(docJson(app)).toEqual(after);
  return { before, after, value };
}

/** Sets the scene frame directly (the wave clip runs at scene fps, so clip frame = scene frame). */
export function setSceneFrame(app: EditorApp, frame: number): void {
  app.session.setState({ time: { ...app.session.getState().time, sceneFrame: frame } });
}

/** A GLB with only a JSON chunk (sniffing and rejection tests). */
export function glbOf(json: unknown): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const chunk = new TextEncoder().encode(text);
  const glb = new Uint8Array(20 + chunk.length);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, glb.length, true);
  view.setUint32(12, chunk.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  glb.set(chunk, 20);
  return glb;
}
