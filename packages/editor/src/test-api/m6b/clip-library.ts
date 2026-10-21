// M6b test API, C12 group (M6B-SPEC §4.8, §0.5; C0 stub file, C12 fills it).
import type { EkzaStudioTestApi } from '../types';
import { type M6bTestApiContext, notImplemented } from './support';

export type ClipLibraryTestApi = Pick<EkzaStudioTestApi, 'library'>;

export function clipLibraryTestApi(_ctx: M6bTestApiContext): ClipLibraryTestApi {
  return {
    library: () => notImplemented('C12', 'library'),
  };
}
