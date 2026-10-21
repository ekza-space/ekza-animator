// M6b test API, INT group (M6B-SPEC §4.8, §0.5; C0 stub file, INT fills it).
import type { M6bTestApiContext } from './support';

export type M6bIntegrationTestApi = Record<never, never>;

export function m6bIntegrationTestApi(_ctx: M6bTestApiContext): M6bIntegrationTestApi {
  return {};
}
