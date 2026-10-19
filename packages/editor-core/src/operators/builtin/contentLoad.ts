// Loader of B13's lazy operator bodies (`contentApply.ts`, M6A-B13-10): every scene, palette, template and image-plane
// operator awaits it in `prepare` (the runner polls again afterwards); a failed load is forgotten so the next run
// tries again, and the run fails with the load error (nothing is written).
import type * as ContentApply from './contentApply';

export type ContentApplyModule = typeof ContentApply;

let loading: Promise<ContentApplyModule> | null = null;
let loaded: ContentApplyModule | null = null;

/** The module once it has loaded (polls run its field checks then), else null. */
export function loadedContentApply(): ContentApplyModule | null {
  return loaded;
}

export function loadContentApply(): Promise<ContentApplyModule> {
  if (loading === null) {
    const attempt = import('./contentApply');
    loading = attempt;
    attempt.then(
      (module) => {
        loaded = module;
      },
      () => {
        if (loading === attempt) loading = null;
      },
    );
  }
  return loading;
}
