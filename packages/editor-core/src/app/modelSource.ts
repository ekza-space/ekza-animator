// The production model reader of a character's asset (parse the GLB, read its skeleton). Its own module, loaded by
// `DEFAULT_DEPS.loadModel` on the first character, so the io skeleton reader (accessors, VRM parts, mesh radii) is
// not part of the editor's first route (§5.27); the load is asynchronous already (the asset bytes come from the
// asset store).
import { parseGlb, skeletonFromGltf } from '@ekza-studio/io';
import type { ModelSource } from './deps';

export async function readModelSource(bytes: Parameters<typeof parseGlb>[0]): Promise<ModelSource> {
  const container = await parseGlb(bytes);
  return { container, skeleton: skeletonFromGltf(container) };
}
