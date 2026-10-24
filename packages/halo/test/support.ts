// Shared headless fixtures of the T6b tests: an app with every lazy operator chunk, and Polybot loaded from the
// repository's fixtures (read with node:fs; the sample loader is the headless app's `readSample` hook).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CharacterId } from '@ekza-studio/doc';
import {
  createHeadlessEditorApp,
  type EditorApp,
  loadModelOperators,
  loadUiWrappers,
  type SampleDef,
} from '@ekza-studio/editor-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function fixture(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(ROOT, 'fixtures', path)));
}

/** A headless app with every lazy operator chunk (rig workspace, clip library, Model, agent, UI wrappers). */
export async function everyOperator(): Promise<EditorApp> {
  const app = createHeadlessEditorApp({
    readSample: (sample: SampleDef) => Promise.resolve(fixture(`models/${sample.file}`)),
  });
  await Promise.all([app.rig.load(), app.library.load(), loadModelOperators(), loadUiWrappers(app)]);
  return app;
}

export async function runOk<T = unknown>(app: EditorApp, op: string, args?: unknown): Promise<T> {
  const result = await app.runUntyped(op, args);
  if (result.status !== 'finished') {
    throw new Error(`${op}: ${result.status} ${JSON.stringify(result)}`);
  }
  return result.value as T;
}

/** Polybot loaded into a fresh app with every chunk; resolves once its character runtime exists. */
export async function polybotApp(): Promise<{ readonly app: EditorApp; readonly character: CharacterId }> {
  const app = await everyOperator();
  const { character } = await runOk<{ character: CharacterId }>(app, 'file.loadSample', { sample: 'polybot' });
  if (app.characters.get(character) === undefined) {
    await new Promise<void>((resolve) => {
      const off = app.characters.subscribe(() => {
        if (app.characters.get(character) === undefined) return;
        off();
        resolve();
      });
    });
  }
  return { app, character };
}
