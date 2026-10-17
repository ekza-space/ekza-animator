// Model loader over @ekza-animator/io/three (GLTFLoader + VRMLoaderPlugin, self-hosted decoders). The three loader
// is created on first use, so creating the services never fails even when it is unavailable, and loads wait for
// `setRenderer` (KTX2 support detection needs the WebGLRenderer; ARCHITECTURE §7): a file dropped before the canvas
// exists loads once it does, and without WebGL the display model never loads while the 2D panels keep working.
import type { DisplayModel, ModelLoader } from '@ekza-animator/editor-core';
import type { GlbContainer } from '@ekza-animator/io';
import { createThreeModelLoader } from '@ekza-animator/io/three';
import type { SkeletonDesc } from '@ekza-animator/rig';

type ThreeLoader = ReturnType<typeof createThreeModelLoader>;

export function createBrowserModelLoader(opts: { readonly decoderPath: string }): ModelLoader {
  let loader: ThreeLoader | null = null;
  let markReady: () => void = () => {};
  const rendererReady = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const instance = (): ThreeLoader => {
    loader ??= createThreeModelLoader({ decoderPath: opts.decoderPath });
    return loader;
  };
  return {
    setRenderer(renderer: unknown): void {
      instance().setRenderer(renderer);
      markReady();
    },
    async load(container: GlbContainer, skeleton: SkeletonDesc): Promise<DisplayModel> {
      await rendererReady;
      return instance().load(container, skeleton);
    },
  };
}
