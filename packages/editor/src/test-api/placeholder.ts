// Degraded e2e test API for an editor whose kernel could not start (e.g. a build where createEditorApp is still a
// stub): `ready`, `webgl` and `renderedFrames` work, every other function throws EkzaError('not-implemented').
import { EkzaError } from '@ekza-studio/anim-core';
import type { WebGlInfo } from '../gl/webgl';
import type { EkzaStudioTestApi } from './types';

declare global {
  interface Window {
    __EKZA_STUDIO_TEST__?: EkzaStudioTestApi;
  }
}

/** Imperative side of the placeholder API, driven by the fallback canvas. */
export interface PlaceholderTestApi {
  readonly api: EkzaStudioTestApi;
  /** The WebGL context exists (or could not be created): resolves `ready`. */
  settle(webgl: WebGlInfo): void;
  countFrame(): void;
}

export function createPlaceholderTestApi(): PlaceholderTestApi {
  let webgl: WebGlInfo = { ok: false, renderer: null };
  let frames = 0;
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const notImplemented = (name: string): never => {
    throw new EkzaError('not-implemented', `editor.testApi.${name} (the editor kernel did not start)`);
  };
  // Every other function throws (M6b, §0.4.9: a Proxy instead of one arrow per function, so the degraded API stays
  // small and never goes stale as test-API groups are added). `then` stays undefined: the API is not a thenable.
  const fixed = {
    ready,
    get webgl() {
      return webgl;
    },
    renderedFrames: () => frames,
  };
  const api = new Proxy(fixed, {
    get: (target, key) =>
      key in target || typeof key !== 'string' || key === 'then'
        ? (Reflect.get(target, key) as unknown)
        : () => notImplemented(key),
  }) as unknown as EkzaStudioTestApi;
  return {
    api,
    settle(info) {
      webgl = info;
      resolveReady();
    },
    countFrame() {
      frames++;
    },
  };
}
