// React bindings of the Rig & Skin shell (C7; lazy, with the rig shell UI and the Rig panels): a version that moves
// whenever a derived Rig & Skin read may change — any document batch, a mesh runtime (re)load, the test pose, the
// Validation profile or ⑤ — and poll reasons re-read on every session or document change.
import type { Disposer } from '@ekza-studio/anim-core';
import { type EditorApp, PANEL, type RigValidation, type RunContext, rigValidation } from '@ekza-studio/editor-core';
import { useMemo, useSyncExternalStore } from 'react';
import { useDocQuery, useSession } from '../../hooks';

function rigSource(app: EditorApp): {
  readonly subscribe: (notify: () => void) => Disposer;
  readonly getSnapshot: () => number;
} {
  let version = 0;
  return {
    subscribe: (notify) => {
      const bump = (): void => {
        version += 1;
        notify();
      };
      const offs: Disposer[] = [
        app.store.subscribe(bump),
        app.meshes.subscribe((_id, event) => event.type !== 'changed' && bump()),
      ];
      let services: Disposer[] = [];
      const attach = (): void => {
        if (!app.rig.loaded || services.length > 0) return;
        services = [app.rig.testPose.subscribe(bump), rigValidation(app).subscribe(bump)];
        bump();
      };
      attach();
      if (!app.rig.loaded) void app.rig.load().then(attach);
      return () => {
        for (const off of [...offs, ...services]) off();
      };
    },
    getSnapshot: () => version,
  };
}

/** Re-renders on every change a Rig & Skin derived read depends on; returns the services' Validation, or null. */
export function useRig(app: EditorApp): RigValidation | null {
  const source = useMemo(() => rigSource(app), [app]);
  useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  return app.rig.loaded ? rigValidation(app) : null;
}

const VIEWPORT: RunContext = { panel: PANEL.viewport };
const docVersion = (): number => 0;
const same = (a: readonly (string | null)[], b: readonly (string | null)[]): boolean =>
  a.length === b.length && a.every((reason, i) => reason === b[i]);

/** The live poll reasons of operator runs (null: can run), re-read on session and document changes. */
export function useReasons(
  app: EditorApp,
  calls: readonly (readonly [string, unknown?])[],
): readonly (string | null)[] {
  useDocQuery(docVersion, ['meshes', 'characters', 'skeletons', 'joints', 'rigs', 'controls']);
  return useSession(
    () =>
      calls.map(([op, args]) => {
        if (app.operators.get(op) === undefined) return 'Loading…';
        const poll = app.operators.poll(op, VIEWPORT, args);
        return poll === true ? null : poll.reason;
      }),
    same,
  );
}
