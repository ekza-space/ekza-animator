// The import pipelines are a lazy chunk of the editor route (M2A-SPEC §5.21.2): `importLoader.ts` loads
// `importPath.ts` once, the import operators load it in `prepare` and use it in `apply`, and the helpers polls need
// synchronously live in `importChecks.ts`, which imports neither pipeline module.
import { readFileSync } from 'node:fs';
import { EkzaError } from '@ekza-animator/anim-core';
import { describe, expect, it } from 'vitest';
import * as checks from '../../src/workflows/importChecks';
import { importPathLoaded, loadImportPath, preloadImportPath } from '../../src/workflows/importLoader';
import * as importAnimation from '../../src/workflows/importAnimation';
import * as importModel from '../../src/workflows/importModel';

const source = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

describe('import pipelines loader', () => {
  it('is not loaded before the first load; loads once and shares the load', async () => {
    let error: unknown = null;
    try {
      importPathLoaded();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EkzaError);
    expect((error as EkzaError).code).toBe('internal');

    const first = loadImportPath();
    expect(loadImportPath()).toBe(first);
    const pipelines = await first;
    await expect(preloadImportPath()).resolves.toBeUndefined();
    expect(importPathLoaded()).toBe(pipelines);
    expect(pipelines.prepareModelImport).toBe(importModel.prepareModelImport);
    expect(pipelines.applyModelImport).toBe(importModel.applyModelImport);
    expect(pipelines.prepareVrmaImport).toBe(importAnimation.prepareVrmaImport);
    expect(pipelines.prepareGlbAnimationImport).toBe(importAnimation.prepareGlbAnimationImport);
    expect(pipelines.applyClipImport).toBe(importAnimation.applyClipImport);
  });

  it('the synchronous helpers stay importable from the pipeline modules (one implementation)', () => {
    expect(importAnimation.animationTargetProblem).toBe(checks.animationTargetProblem);
    expect(importAnimation.importTarget).toBe(checks.importTarget);
    expect(importAnimation.isAnimationOnlyGlb).toBe(checks.isAnimationOnlyGlb);
    expect(importModel.clipNameTaken).toBe(checks.clipNameTaken);
    expect(importModel.clipNamesOf).toBe(checks.clipNamesOf);
  });

  it('no eager module imports the pipelines statically (the chunk stays off the initial route)', () => {
    const pipeline = /from '(\.\.\/)*(\.\/|workflows\/)?(importModel|importAnimation|importPath)'/;
    for (const path of [
      'workflows/importChecks.ts',
      'workflows/importLoader.ts',
      'operators/builtin/file.ts',
      'operators/builtin/clip.ts',
      'operators/builtin/importers.ts',
      'index.ts',
    ]) {
      const statics = source(path)
        .split('\n')
        .filter((line) => pipeline.test(line) && !line.startsWith('import type') && !line.includes('import type '));
      expect({ path, statics }).toEqual({ path, statics: [] });
    }
  });
});
