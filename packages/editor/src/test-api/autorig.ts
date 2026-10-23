// Auto-Rig test API group (AUTORIG-SPEC §10 D0, §11): `autorig()` — the wizard's step, progress, subject, intake,
// start pose, busy stage and slices — read from a provider the Auto-Rig shell registers for its app in e2e mode
// (`provideAutoRigTestState`, exported by `@ekza-studio/editor/host`); null while no Auto-Rig shell is mounted (e.g. on
// `/editor`). Small and marker-free: the shell imports the registration without the test API chunk.
import type { EditorApp } from '@ekza-studio/editor-core';
import type { EkzaStudioTestApi } from './types';

/** What `autorig()` returns (plain JSON for `page.evaluate`). */
export interface AutoRigTestState {
  readonly step: string;
  readonly reachable: Record<string, boolean>;
  readonly done: Record<string, boolean>;
  readonly subject: { readonly character: string | null; readonly meshes: readonly string[] };
  readonly intake: unknown;
  readonly startPose: { readonly armAngle: number; readonly kind: 't' | 'a' } | null;
  readonly busy: { readonly stage: string; readonly fraction: number | null } | null;
  readonly slices: Record<string, unknown>;
}

const providers = new WeakMap<object, () => AutoRigTestState>();

/** Registers the Auto-Rig shell's state provider for an app; the disposer removes it (shell unmount). */
export function provideAutoRigTestState(app: EditorApp, provider: () => AutoRigTestState): () => void {
  providers.set(app, provider);
  return () => {
    if (providers.get(app) === provider) providers.delete(app);
  };
}

export type AutoRigTestApi = Pick<EkzaStudioTestApi, 'autorig'>;

export function autorigTestApi(ctx: { readonly shell: { readonly app: EditorApp } }): AutoRigTestApi {
  return {
    autorig() {
      const provider = providers.get(ctx.shell.app);
      return provider === undefined ? null : provider();
    },
  };
}
