// The parity probe (STUDIO-TOUCH-SPEC §20.5, ST-29; T6b): in e2e builds the Halo shell puts it on
// `window.__EKZA_HALO_PARITY__` once, for its app. It stays there when Halo unmounts, so the browser parity spec
// (`apps/web/e2e/ha-parity.spec.ts`) can take a census of the same EditorApp after a same-page switch to Studio Pro and
// to Auto-Rig (the operators that exist only while their UI is mounted), join them and check the Disclosure Manifest
// in the page. Never installed outside e2e builds; a lazy chunk of the shell.
import { type EditorApp, loadModelOperators, loadUiWrappers } from '@ekza-studio/editor-core';
import { type Census, joinCensus, liveCensus } from './census';
import { type CallSitePair, checkParity, type ParityReport } from './check';

export interface HaloParityProbe {
  /** Loads every lazy operator chunk the app knows (rig workspace, clip library, Model operators, UI wrappers and the
   *  agent operators they bring). */
  loadAll(): Promise<void>;
  census(mount: string): Census;
  join(parts: readonly Census[]): Census;
  /** The parity report of a joined census against the manifest (and the call-site pairs of the static scan). */
  check(census: Census, callSites: readonly CallSitePair[]): ParityReport;
}

declare global {
  interface Window {
    __EKZA_HALO_PARITY__?: HaloParityProbe;
  }
}

export function installParityProbe(app: EditorApp): void {
  if (typeof window === 'undefined' || window.__EKZA_HALO_PARITY__ !== undefined) return;
  window.__EKZA_HALO_PARITY__ = {
    async loadAll() {
      await Promise.all([app.rig.load(), app.library.load(), loadModelOperators(), loadUiWrappers(app)]);
    },
    census: (mount) => liveCensus(app, mount),
    join: joinCensus,
    check: (census, callSites) => checkParity({ census, callSites }),
  };
}
