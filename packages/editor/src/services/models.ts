// Model loader over @ekza-animator/io/three (GLTFLoader + VRMLoaderPlugin, self-hosted decoders). The three loader
// module is a lazy chunk (M2A-SPEC §5.21.2, M-2 boundary 1): it loads on the first display-model load, or earlier on
// intent (`preloadModelLoader`: a file dragged over the window, the Open dialog, a sample button hovered or pressed,
// a project being opened), never at idle. Loads wait for `setRenderer` (KTX2 support detection needs the
// WebGLRenderer; ARCHITECTURE §7): a file dropped before the canvas exists loads once it does, and without WebGL the
// display model never loads while the 2D panels keep working.
import type { DisplayModel, ModelLoader } from '@ekza-animator/editor-core';
import type { GlbContainer } from '@ekza-animator/io';
import type * as IoThree from '@ekza-animator/io/three';
import type { SkeletonDesc } from '@ekza-animator/rig';

type ThreeLoader = ReturnType<typeof IoThree.createThreeModelLoader>;

let threeModule: Promise<typeof IoThree> | null = null;

/** Starts loading the three.js model loader chunk (idempotent; a failed load is retried by the next call). */
export function preloadModelLoader(): Promise<typeof IoThree> {
  if (threeModule === null) {
    threeModule = import('@ekza-animator/io/three');
    threeModule.catch(() => {
      threeModule = null;
    });
  }
  return threeModule;
}

export function createBrowserModelLoader(opts: { readonly decoderPath: string }): ModelLoader {
  let loader: ThreeLoader | null = null;
  let renderer: unknown = null;
  let hasRenderer = false;
  let markReady: () => void = () => {};
  const rendererReady = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const instance = async (): Promise<ThreeLoader> => {
    if (loader === null) {
      const io = await preloadModelLoader();
      if (loader === null) {
        loader = io.createThreeModelLoader({ decoderPath: opts.decoderPath });
        if (hasRenderer) loader.setRenderer(renderer);
      }
    }
    return loader;
  };
  return {
    setRenderer(next: unknown): void {
      renderer = next;
      hasRenderer = true;
      loader?.setRenderer(next);
      markReady();
    },
    async load(container: GlbContainer, skeleton: SkeletonDesc): Promise<DisplayModel> {
      await rendererReady;
      return (await instance()).load(container, skeleton);
    },
  };
}
