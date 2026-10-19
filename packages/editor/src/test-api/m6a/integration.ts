// M6a test API, integration group (M6A-SPEC §4.8; E2E-MOD-30): expression weights.
import type { EkzaAnimatorTestApi } from '../types';
import { type M6aTestApiContext, notImplemented } from './support';

export type IntegrationTestApi = Pick<EkzaAnimatorTestApi, 'setExpression'>;

export function integrationTestApi(_ctx: M6aTestApiContext): IntegrationTestApi {
  return {
    setExpression: () => notImplemented('INT', 'setExpression'),
  };
}
