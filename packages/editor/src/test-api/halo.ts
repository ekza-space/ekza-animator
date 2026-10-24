// Halo test API group (STUDIO-TOUCH-SPEC §20.7; T2 freezes it, T6a and the stage packages feed it): `halo()` — the
// stage, the open sheet, the Halo's noun and petals, the Thread layer, the Thumb key, the visible-target count, the
// touch counter and per-package slices — read from a provider the Halo shell registers for its app in e2e mode
// (`provideHaloTestState`); null while no Halo shell is mounted (e.g. on `/editor`). Small and marker-free, like
// `./autorig.ts`: the shell imports the registration without the test API chunk. Also every route's `mountedShell()`
// and `navigate()` (the host's navigation port, as a UI control calls it: ha-12 and the switch specs).
import type { EditorApp, HaloStage } from '@ekza-studio/editor-core';
import type { HostShell } from '../host/types';
import type { EkzaStudioTestApi } from './types';

/** What `halo()` returns (plain JSON for `page.evaluate`). */
export interface HaloTestState {
  readonly stage: HaloStage;
  /** The open sheet ('more', 'numbers', 'share', …), else null. */
  readonly sheet: string | null;
  /** The noun the Halo shows (§6: 'joint', 'control', 'mesh', 'face', 'key', 'clip', …) and its record id. */
  readonly noun: { readonly kind: string; readonly id: string | null } | null;
  /** The open Halo's petals, operator ids in ring order (⋯ More excluded); [] while no Halo is open. */
  readonly petals: readonly string[];
  /** The Thread's layer: 0 Timeline, 1 Keys, 2 Curves. */
  readonly threadLayer: 0 | 1 | 2;
  /** The Thumb key (§5.5): its state and what the next tap and the next drag will do (null: nothing). */
  readonly thumb: {
    readonly mode: 'hidden' | 'off' | 'once' | 'locked' | 'held';
    readonly tap: string | null;
    readonly drag: string | null;
  };
  /** Visible targets on screen (§4.8, AS-ST-17). */
  readonly visibleTargets: number;
  /** Touches counted since the shell mounted (journeys, AS-ST-4). */
  readonly touches: number;
  /** Per-package extras (plain JSON), keyed by the owner ('thread', 'rig', 'share', …). */
  readonly slices: Record<string, unknown>;
}

const providers = new WeakMap<object, () => HaloTestState>();

/** Registers the Halo shell's state provider for an app; the disposer removes it (shell unmount). */
export function provideHaloTestState(app: EditorApp, provider: () => HaloTestState): () => void {
  providers.set(app, provider);
  return () => {
    if (providers.get(app) === provider) providers.delete(app);
  };
}

export type HaloTestApi = Pick<EkzaStudioTestApi, 'halo' | 'mountedShell' | 'navigate'>;

export function haloTestApi(ctx: { readonly shell: Pick<HostShell, 'app' | 'mounted' | 'navigation'> }): HaloTestApi {
  return {
    halo() {
      const provider = providers.get(ctx.shell.app);
      return provider === undefined ? null : provider();
    },
    mountedShell() {
      return ctx.shell.mounted.getState()?.kind ?? null;
    },
    navigate(request) {
      return ctx.shell.navigation.go(request);
    },
  };
}
