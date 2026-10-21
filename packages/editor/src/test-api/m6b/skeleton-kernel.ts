// M6b test API, C2 group (M6B-SPEC §4.8, §0.5; C0 stub file, C2 fills it).
import type { M6bTestApiContext } from './support';

export type SkeletonKernelTestApi = Record<never, never>;

export function skeletonKernelTestApi(_ctx: M6bTestApiContext): SkeletonKernelTestApi {
  return {};
}
