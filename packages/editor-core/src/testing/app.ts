// createFakeEditorApp (MVP-SPEC §7 WP-0b, then WP-7a): the real editor kernel over the naive parts of the shared
// test kit — naive document store (strictPut on), naive curve engine, naive FK rig program — so unit tests and the
// /dev/panels harness exercise the production runner, history, edit kernel, evaluation and keymap. It never calls
// the sibling packages' implementations, so it works whatever state they are in, and it never imports Node APIs,
// so it runs in Vitest browser mode as well.
import type { DocSnapshot } from '@ekza-studio/doc';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { createKernelApp } from '../app/kernel';
import { DCC_KEYMAP } from '../keymap/dcc';
import type { EditorApp, EditorServices } from '../types';
import { naiveKernelDeps } from './deps';
import { createFakeServices } from './services';
import { createNaiveStore } from './store/naiveStore';

export interface FakeEditorApp extends EditorApp {
  readonly calls: readonly { readonly id: string; readonly args: unknown }[];
}

/**
 * A full EditorApp over the naive kit:
 *
 * - `snapshot` is loaded into the store; the first character becomes active and every character's first clip is its
 *   active clip.
 * - `skeleton` gives every character a runtime (rig program, pose buffers, samplers), created synchronously; without
 *   it there are no runtimes, but channel values and states still evaluate from the curves.
 * - `services` override the recording fakes of `createFakeServices()` (no model loader, validator or storage).
 * - Preferences start with `firstRunDone: true`; the `dcc` keymap is contributed; no operators are registered.
 *   Every `run` is recorded in `calls`; registered operators run through the kernel's runner, unknown ids resolve
 *   to `cancelled: "unknown operator '<id>'"`.
 */
export function createFakeEditorApp(opts?: {
  readonly snapshot?: DocSnapshot;
  readonly skeleton?: SkeletonDesc;
  readonly services?: Partial<EditorServices>;
  readonly platform?: 'mac' | 'other';
}): FakeEditorApp {
  const store = createNaiveStore();
  if (opts?.snapshot !== undefined) store.load(opts.snapshot);
  const calls: { readonly id: string; readonly args: unknown }[] = [];
  const app = createKernelApp(
    {
      services: { ...createFakeServices(), ...opts?.services },
      store,
      platform: opts?.platform ?? 'other',
      builtins: false,
      prefDefaults: { firstRunDone: true },
      onRun: (id, args) => calls.push({ id, args }),
    },
    naiveKernelDeps(opts?.skeleton ?? null),
  );
  app.contribute({ kind: 'keymap', bindings: DCC_KEYMAP });
  // Same object (the kernel keys its internals by identity), plus the recorded calls.
  return Object.defineProperty(app, 'calls', { get: () => calls, enumerable: true }) as FakeEditorApp;
}
