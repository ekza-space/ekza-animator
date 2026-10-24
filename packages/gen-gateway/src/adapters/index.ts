// The built-in provider adapters (G1: Tripo and Meshy, Q-GEN-2) and their environment variable names.
import type { ProviderEnv } from '../config.ts';
import { createMeshyAdapter } from './meshy.ts';
import { createTripoAdapter } from './tripo.ts';
import type { ProviderAdapter } from './types.ts';

export function defaultAdapters(): ProviderAdapter[] {
  return [createTripoAdapter(), createMeshyAdapter()];
}

export function providerEnvs(adapters: readonly ProviderAdapter[]): ProviderEnv[] {
  return adapters.map((a) => ({
    id: a.id,
    keyEnv: a.keyEnv,
    baseUrlEnv: a.baseUrlEnv,
    webhookSecretEnv: a.webhookSecretEnv,
  }));
}

export { createMeshyAdapter, MESHY_MODELS, MESHY_USD_PER_CREDIT } from './meshy.ts';
export { createTripoAdapter, TRIPO_MODELS, TRIPO_WEBHOOK_WINDOW_S } from './tripo.ts';
export * from './types.ts';
