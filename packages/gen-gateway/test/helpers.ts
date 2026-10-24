import { createGenerationClient, type GenerationClient, type GenJob, type GenRequest, isTerminal } from '@ekza-studio/gen-core';
import {
  type BlobStore,
  createGateway,
  createRedactingLogger,
  defaultAdapters,
  type Gateway,
  type JobStore,
  loadGatewayConfig,
  providerEnvs,
} from '../src/index.ts';
import { type MockProviderServer, startMockProviders } from '../src/testing/index.ts';

export const TOKEN = 'test-token-0123456789abcdef0123456789';

export interface Setup {
  readonly mock: MockProviderServer;
  readonly gw: Gateway;
  readonly client: GenerationClient;
  readonly lines: string[];
  readonly env: Record<string, string>;
  /** Calls the handler as the standalone server would (peer 127.0.0.1). */
  fetch(input: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export async function setup(opts?: {
  readonly env?: Record<string, string>;
  readonly store?: JobStore;
  readonly blobs?: BlobStore;
  readonly mock?: MockProviderServer;
  readonly authenticate?: (req: Request) => Promise<string | null>;
}): Promise<Setup> {
  const mock = opts?.mock ?? (await startMockProviders());
  const env: Record<string, string> = {
    GEN_GATEWAY_ENABLED: '1',
    GEN_GATEWAY_TOKEN: TOKEN,
    GEN_CAP_DAILY_USD: '5',
    GEN_CAP_MONTHLY_USD: '20',
    TRIPO_API_KEY: mock.keys.tripo,
    MESHY_API_KEY: mock.keys.meshy,
    GEN_TRIPO_BASE_URL: mock.tripoBase,
    GEN_MESHY_BASE_URL: mock.meshyBase,
    ...opts?.env,
  };
  const adapters = defaultAdapters();
  const config = loadGatewayConfig(env, 'standalone', providerEnvs(adapters), {
    session: opts?.authenticate !== undefined,
  });
  const lines: string[] = [];
  const log = createRedactingLogger((l) => lines.push(l), [], 'debug');
  const gw = createGateway({
    config,
    adapters,
    log,
    timeScale: 0.002,
    requestTimeoutScale: 0.05,
    basePath: '/api/gen',
    heartbeatMs: 50,
    ...(opts?.store ? { store: opts.store } : {}),
    ...(opts?.blobs ? { blobs: opts.blobs } : {}),
    ...(opts?.authenticate ? { authenticate: opts.authenticate } : {}),
  });
  await gw.start();
  const fetchVia = (input: string, init?: RequestInit): Promise<Response> =>
    gw.handle(new Request(new URL(input, 'http://localhost'), init), { remoteAddress: '127.0.0.1' });
  const client = createGenerationClient({
    baseUrl: '/api/gen',
    token: () => TOKEN,
    pollMs: 5,
    fetch: (input, init) => fetchVia(String(input), init),
  });
  return {
    mock,
    gw,
    client,
    lines,
    env,
    fetch: fetchVia,
    async close() {
      await gw.close();
      if (opts?.mock === undefined) await mock.close();
    },
  };
}

export function untilDone(client: GenerationClient, id: string, timeoutMs = 20_000): Promise<GenJob> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      w.close();
      reject(new Error(`job ${id} did not finish`));
    }, timeoutMs);
    const w = client.watch(
      id,
      (job) => {
        if (isTerminal(job.state)) {
          clearTimeout(timer);
          w.close();
          resolve(job);
        }
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

let keySeq = 0;
export function request(over: Partial<GenRequest> & Pick<GenRequest, 'provider' | 'op'>): GenRequest {
  keySeq += 1;
  return {
    params: {},
    idempotencyKey: `test-key-${Date.now()}-${keySeq}`.padEnd(20, 'x'),
    maxCostUsd: 2,
    attestation: { tier: 'paid' },
    ...over,
  };
}
