// WP-0a placeholder of the e2e test API (MVP-SPEC §4.8): `ready`, `webgl` and `renderedFrames` work; everything
// else throws until WP-8 installs the full API.
import { EkzaError } from '@ekza-animator/anim-core';
import type { EkzaAnimatorTestApi } from './types';

declare global {
  interface Window {
    __EKZA_ANIMATOR_TEST__?: EkzaAnimatorTestApi;
  }
}

export interface WebGlInfo {
  readonly ok: boolean;
  readonly renderer: string | null;
}

/** Imperative side of the placeholder API, driven by the editor's canvas. */
export interface PlaceholderTestApi {
  readonly api: EkzaAnimatorTestApi;
  /** The WebGL context exists (or could not be created): resolves `ready`. */
  settle(webgl: WebGlInfo): void;
  countFrame(): void;
}

/** True when the build allows e2e mode and the URL asks for it (`?e2e=1`). */
export function isE2eRequested(buildAllowsE2e: boolean, search: string): boolean {
  return buildAllowsE2e && new URLSearchParams(search).get('e2e') === '1';
}

export function createPlaceholderTestApi(): PlaceholderTestApi {
  let webgl: WebGlInfo = { ok: false, renderer: null };
  let frames = 0;
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const notImplemented = (name: string): never => {
    throw new EkzaError('not-implemented', `editor.testApi.${name}`);
  };
  const api: EkzaAnimatorTestApi = {
    ready,
    get webgl() {
      return webgl;
    },
    run: () => notImplemented('run'),
    loadFile: () => notImplemented('loadFile'),
    state: () => notImplemented('state'),
    counts: () => notImplemented('counts'),
    characters: () => notImplemented('characters'),
    controls: () => notImplemented('controls'),
    clips: () => notImplemented('clips'),
    curves: () => notImplemented('curves'),
    curveValue: () => notImplemented('curveValue'),
    channelValues: () => notImplemented('channelValues'),
    overrides: () => notImplemented('overrides'),
    boneWorld: () => notImplemented('boneWorld'),
    facing: () => notImplemented('facing'),
    panes: () => notImplemented('panes'),
    cameraOf: () => notImplemented('cameraOf'),
    screenOfControl: () => notImplemented('screenOfControl'),
    screenOfManipulator: () => notImplemented('screenOfManipulator'),
    graph: () => notImplemented('graph'),
    screenOfKey: () => notImplemented('screenOfKey'),
    screenOfHandle: () => notImplemented('screenOfHandle'),
    screenOfCurve: () => notImplemented('screenOfCurve'),
    screenOfFrame: () => notImplemented('screenOfFrame'),
    screenOfTick: () => notImplemented('screenOfTick'),
    lastExport: () => notImplemented('lastExport'),
    renderedFrames: () => frames,
  };
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

/** Creates a throwaway WebGL2 context to learn whether the canvas can render and with which GPU. */
export function probeWebGl(): WebGlInfo {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (gl === null) return { ok: false, renderer: null };
    const info = rendererName(gl);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true, renderer: info };
  } catch {
    return { ok: false, renderer: null };
  }
}

export function rendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string | null {
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const name: unknown = gl.getParameter(debug === null ? gl.RENDERER : debug.UNMASKED_RENDERER_WEBGL);
  return typeof name === 'string' ? name : null;
}
