// Degraded e2e test API for an editor whose kernel could not start (e.g. a build where createEditorApp is still a
// stub): `ready`, `webgl` and `renderedFrames` work, every other function throws EkzaError('not-implemented').
import { EkzaError } from '@ekza-animator/anim-core';
import type { WebGlInfo } from '../gl/webgl';
import type { EkzaAnimatorTestApi } from './types';

declare global {
  interface Window {
    __EKZA_ANIMATOR_TEST__?: EkzaAnimatorTestApi;
  }
}

/** Imperative side of the placeholder API, driven by the fallback canvas. */
export interface PlaceholderTestApi {
  readonly api: EkzaAnimatorTestApi;
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
    attrs: () => notImplemented('attrs'),
    controlWorld: () => notImplemented('controlWorld'),
    curveSlope: () => notImplemented('curveSlope'),
    limbs: () => notImplemented('limbs'),
    limbPivots: () => notImplemented('limbPivots'),
    dopeSheet: () => notImplemented('dopeSheet'),
    screenOfDopeKey: () => notImplemented('screenOfDopeKey'),
    screenOfDopeRegion: () => notImplemented('screenOfDopeRegion'),
    timelineTicks: () => notImplemented('timelineTicks'),
    screenOfBand: () => notImplemented('screenOfBand'),
    screenOfRegionHandle: () => notImplemented('screenOfRegionHandle'),
    screenOfTween: () => notImplemented('screenOfTween'),
    tweenTarget: () => notImplemented('tweenTarget'),
    autosave: () => notImplemented('autosave'),
    flushAutosave: () => notImplemented('flushAutosave'),
    agent: () => notImplemented('agent'),
    historySteps: () => notImplemented('historySteps'),
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
