// Shared helpers of the ops.* headless tests (WP-7b): the production kernel (`createEditorApp` over the real doc,
// anim-core, rig and io packages) with the test kit's recording services and a glTF-Validator, fixture import,
// runtime waits, document snapshots and the undo/redo-exactness check of §6.3. The tests skip until every sibling
// package has merged (they call real readers, rig solvers and writers), MVP-SPEC §8.1.
import { type AnimCurve, curveEngine, EkzaError } from '@ekza-studio/anim-core';
import { type CharacterId, emptySnapshot, fractionalIndex, seededIdSource } from '@ekza-studio/doc';
import { type LicensedFixture, readFixture } from '@ekza-studio/doc/testing';
import {
  type CharacterRuntime,
  createEditorApp,
  type EditorApp,
  type EditorServices,
  type ImportResult,
} from '@ekza-studio/editor-core';
import { createFakeServices, type FakeServices } from '@ekza-studio/editor-core/testing';
import { checkInputBudget, parseGlb, type ValidationIssue, type ValidationReport } from '@ekza-studio/io';
import { autoRig, compileRig, mirrorPose } from '@ekza-studio/rig';
import * as gltfValidator from 'gltf-validator';
import { expect } from 'vitest';

function implemented(probe: () => unknown): boolean {
  try {
    const result = probe();
    if (result instanceof Promise) result.catch(() => {});
    return true;
  } catch (error) {
    return !(error instanceof EkzaError && error.code === 'not-implemented');
  }
}

const EMPTY: AnimCurve = { keys: [], weighted: false, pre: 'constant', post: 'constant' };

/** All four sibling packages are implemented (WP-1 anim-core, WP-2 doc, WP-3 rig, WP-4 io). */
export const SIBLINGS_READY =
  implemented(() => curveEngine.compile(EMPTY)) &&
  implemented(() => fractionalIndex(null, null)) &&
  implemented(() => emptySnapshot()) &&
  implemented(() => compileRig(autoRig(undefined as never, undefined as never), undefined as never)) &&
  implemented(() => mirrorPose(undefined as never, new Map(), 'flip', null)) &&
  implemented(() => parseGlb(new Uint8Array(0))) &&
  implemented(() => checkInputBudget(undefined as never));

export const BLOCKED = '[needs WP-1, WP-2, WP-3, WP-4]';

/** Khronos glTF-Validator report (VRM extensions are not known to it: UNSUPPORTED_EXTENSION is ignored). */
export async function validate(bytes: Uint8Array): Promise<ValidationReport> {
  const report = await gltfValidator.validateBytes(bytes, {
    format: 'glb',
    maxIssues: 0,
    ignoredIssues: ['UNSUPPORTED_EXTENSION'],
    writeTimestamp: false,
  });
  const issues: ValidationIssue[] = report.issues.messages.map((message) => ({
    code: message.code,
    severity: Math.min(3, Math.max(0, message.severity)) as ValidationIssue['severity'],
    message: message.message,
    ...(message.pointer === undefined ? {} : { pointer: message.pointer }),
  }));
  return {
    errors: report.issues.numErrors,
    warnings: report.issues.numWarnings,
    infos: report.issues.numInfos,
    issues,
  };
}

export interface RealApp {
  readonly app: EditorApp;
  readonly services: FakeServices;
}

/** The production kernel with recording services, the validator and seeded ids. */
export function realApp(opts?: {
  readonly validator?: boolean;
  readonly seed?: number;
  /** Wraps the asset store (e.g. to hold a read while a test acts). */
  readonly assets?: (store: EditorServices['assets']) => EditorServices['assets'];
}): RealApp {
  const services = createFakeServices();
  const withValidator: EditorServices = {
    ...services,
    assets: opts?.assets?.(services.assets) ?? services.assets,
    validate: opts?.validator === false ? null : validate,
  };
  const app = createEditorApp({ services: withValidator, idSource: seededIdSource(opts?.seed ?? 7) });
  return { app, services };
}

export async function runOk(app: EditorApp, id: string, args?: unknown): Promise<unknown> {
  const result = await app.runUntyped(id, args);
  if (result.status !== 'finished') throw new Error(`${id} did not finish: ${JSON.stringify(result)}`);
  return result.value;
}

/** Resolves with the character's runtime once the registry has built it (asynchronous after an import). */
export function runtimeOf(app: EditorApp, character: CharacterId, timeoutMs = 30_000): Promise<CharacterRuntime> {
  const existing = app.characters.get(character);
  if (existing !== undefined) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`no runtime for ${character} after ${timeoutMs} ms`));
    }, timeoutMs);
    const off = app.characters.subscribe((event) => {
      const runtime = app.characters.get(character);
      if (event.id !== character || runtime === undefined) return;
      clearTimeout(timer);
      off();
      resolve(runtime);
    });
  });
}

/** Imports a licensed fixture through `file.importModel` and waits for its runtime. */
export async function importFixture(
  app: EditorApp,
  name: LicensedFixture,
  options?: Record<string, unknown>,
): Promise<ImportResult & { readonly runtime: CharacterRuntime }> {
  const result = (await runOk(app, 'file.importModel', {
    name,
    bytes: readFixture(name),
    ...(options === undefined ? {} : { options }),
  })) as ImportResult;
  return { ...result, runtime: await runtimeOf(app, result.character) };
}

export function docJson(app: EditorApp): unknown {
  return JSON.parse(JSON.stringify(app.store.snapshot())) as unknown;
}

/** §6.3: one undo reverts the operator exactly, one redo replays it exactly (document snapshots deep-equal). */
export async function expectUndoRedoExact(app: EditorApp, id: string, args?: unknown): Promise<unknown> {
  const before = docJson(app);
  const value = await runOk(app, id, args);
  const after = docJson(app);
  expect(after).not.toEqual(before);
  await runOk(app, 'edit.undo');
  expect(docJson(app)).toEqual(before);
  await runOk(app, 'edit.redo');
  expect(docJson(app)).toEqual(after);
  return value;
}

export function setSceneFrame(app: EditorApp, frame: number): void {
  app.session.setState({ time: { ...app.session.getState().time, sceneFrame: frame } });
}
