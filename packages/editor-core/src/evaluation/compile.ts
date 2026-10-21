// The app's curve engine for curves that are not in the document (M2A-SPEC §5.15.1: the Graph Editor draws buffer
// curves with the same engine — cycle-aware auto tangents on cyclic curves, §5.23 — as the curves themselves).
import type { AnimCurve, CompiledAnimCurve } from '@ekza-studio/anim-core';
import { internalsOf } from '../app/internals';
import type { EditorApp } from '../types';

/** Compiles `curve` with the engine the app evaluates and draws its document curves with. */
export function compileWithAppEngine(app: EditorApp, curve: AnimCurve): CompiledAnimCurve {
  return internalsOf(app).deps.curves.engine.compile(curve);
}
