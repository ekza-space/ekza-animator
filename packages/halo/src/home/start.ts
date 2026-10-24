// Home, Share and files while the Halo shell is mounted (STUDIO-TOUCH-SPEC §13.3, §17, §9 J10, §6.7 `recovery`; T11;
// P-T6A-4, P-T3-4): the Share sheet in the frame's sheet slot (`registerHaloSheet`, a lazy chunk prefetched at idle,
// S23) with the journeys' touch counter, the toasts, the project save and the storage card; the host's recovery hook
// (`provideRecoveryHook(app, {firstRun: false, offer})`: Halo shows Home › Continue, never the Recovery dialog, §17);
// and the silent restore of this tab's project after a reload (`./resume`).
import { provideRecoveryHook } from '@ekza-studio/editor/host';
import { type ComponentType, createElement, type JSX, lazy, Suspense } from 'react';
import { en } from '../i18n/en';
import type { HaloSheetProps } from '../manifest/sheets';
import type { HaloController } from '../shell/controller';
import { registerHaloSheet } from '../shell/Sheets';
import type { ShareShell } from '../sheets/share';
import { documentEmpty } from './model';
import { createResume, type Resume } from './resume';
import { createStorageCard, rememberedAuthor, saveProject, type StorageCardStore } from './save';

const ShareSheet = lazy(() => import('../sheets/share'));

/** What Home, the project menu and Share reach of T11's services for a mounted shell. */
export interface HomeServices {
  readonly storage: StorageCardStore;
  /** Share's baker, kept by the shell (the sheet makes it on first open): a prepared file outlives the sheet. */
  readonly share: ShareShell['holder'];
  readonly resume: Resume;
  /** *Save project to Files* (`file.save`; the host's save prompt on iOS), then the storage card. */
  saveProject(): Promise<boolean>;
  /** One touch of the journeys' counter (AS-ST-4). */
  touch(): void;
}

const services = new WeakMap<HaloController, HomeServices>();

/** The services of a controller (made on first use; `startHome` uses the same). */
export function homeServices(controller: HaloController): HomeServices {
  let found = services.get(controller);
  if (found === undefined) {
    const { ctx } = controller;
    const storage = createStorageCard((text) => ctx.toasts.push({ key: 'storage', text }));
    const resume = createResume(controller);
    found = {
      storage,
      resume,
      share: { baker: null },
      saveProject: () => saveProject(ctx, storage),
      touch: () => ctx.store.set((s) => ({ touches: s.touches + 1 })),
    };
    services.set(controller, found);
  }
  return found;
}

/** The Share sheet in the frame's slot, with Share's own shell (the counter, the toasts, the save, the card). */
function shareHost(controller: HaloController, home: HomeServices): ComponentType<HaloSheetProps> {
  const shell: ShareShell = {
    touch: home.touch,
    toasts: controller.ctx.toasts,
    saveProject: () => home.saveProject().then(() => undefined),
    author: rememberedAuthor,
    holder: home.share,
    storage: home.storage,
  };
  return function ShareHost({ ctx, args }: HaloSheetProps): JSX.Element {
    return createElement(
      Suspense,
      { fallback: null },
      createElement(ShareSheet, { ctx, shell, ...(args === undefined ? {} : { args }) }),
    );
  };
}

/** Starts T11's parts for a mounted shell; the disposer ends them. */
export function startHome(controller: HaloController): () => void {
  const { ctx } = controller;
  const { app, store } = ctx;
  const home = homeServices(controller);
  const offs: (() => void)[] = [];
  offs.push(registerHaloSheet('share', shareHost(controller, home)));
  offs.push(home.resume.start());
  // §6.7 `recovery` → Home › Continue (the host decides when: once per page, orphaned slots, no dialog open)
  offs.push(
    provideRecoveryHook(app, {
      firstRun: false,
      offer: () => {
        if (home.resume.restoring()) return;
        if (documentEmpty(app)) {
          store.set({ home: true, halo: null });
          return;
        }
        ctx.toasts.push({
          key: 'recovery',
          text: en.home.unsavedWaiting,
          durationMs: 10_000,
          action: { label: en.home.showContinue, run: () => store.set({ home: true, halo: null }) },
        });
      },
    }),
  );
  // S23: the Share chunk at idle, with the other sheets
  const idle =
    typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(() => void import('../sheets/share').catch(() => {}), { timeout: 3000 })
      : null;
  offs.push(() => {
    if (idle !== null) window.cancelIdleCallback(idle);
  });
  return () => {
    for (const off of offs.splice(0).reverse()) off();
  };
}
