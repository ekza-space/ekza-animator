// The host side of the intake worker `../workers/intake.worker.ts` (MODELING-PLAN §7.2 G-a): tells editor-core's intake
// client (`app.meshes`, read on the first job) how to create the worker. Eager and tiny: the worker's code is its own
// lazy entry, which only `new Worker(new URL(…))` references, so mesh-wasm and the meshoptimizer WASM never enter the
// route (the `mesh-wasm` marker never appears there).
import type { EditorApp, IntakeWorkerHost, IntakeWorkerPort } from '@ekza-studio/editor-core';

/** Lets the app's intake operators run their chain in a module worker (when the browser has workers). */
export function installIntakeWorker(app: EditorApp): void {
  if (typeof Worker === 'undefined') return;
  (app.meshes as unknown as IntakeWorkerHost).intakeWorker = () =>
    new Worker(new URL('../workers/intake.worker.ts', import.meta.url), {
      type: 'module',
      name: 'intake',
    }) as unknown as IntakeWorkerPort;
}
