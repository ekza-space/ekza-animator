// The display-model loader as the kernel exposes it (`app.services.models`): loads wait until the host has called
// `setRenderer` (KTX2 support detection needs the WebGLRenderer, MVP-SPEC §4.5 ModelLoader). Hosts must call
// `app.services.models.setRenderer(gl)` on this wrapper, not on the loader they passed in.
import type { GlbContainer } from '@ekza-studio/io';
import type { SkeletonDesc } from '@ekza-studio/rig';
import type { DisplayModel, ModelLoader } from '../types';

export interface GatedModelLoader extends ModelLoader {
  /** True once `setRenderer` has been called. */
  readonly hasRenderer: boolean;
}

export function gateModelLoader(loader: ModelLoader): GatedModelLoader {
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  let hasRenderer = false;
  return {
    get hasRenderer() {
      return hasRenderer;
    },
    setRenderer(renderer: unknown): void {
      loader.setRenderer(renderer);
      hasRenderer = true;
      release();
    },
    async load(container: GlbContainer, skeleton: SkeletonDesc): Promise<DisplayModel> {
      await ready;
      return loader.load(container, skeleton);
    },
  };
}
