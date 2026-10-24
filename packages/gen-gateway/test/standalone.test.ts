import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createGenerationClient, isTerminal } from '@ekza-studio/gen-core';
import { createRedactingLogger, GatewayConfigError, REDACTED } from '../src/index.ts';
import { startStandaloneGateway } from '../src/node/index.ts';
import { makePng, startMockProviders } from '../src/testing/index.ts';

const MAIN = join(__dirname, '../src/node/main.ts');

describe('standalone server', () => {
  it('serves the protocol over real HTTP in loopback mode, SSE included', async () => {
    const mock = await startMockProviders();
    const lines: string[] = [];
    const gw = await startStandaloneGateway({
      env: {
        GEN_GATEWAY_ENABLED: '1',
        GEN_GATEWAY_HOST: '127.0.0.1',
        GEN_CAP_DAILY_USD: '2',
        GEN_CAP_MONTHLY_USD: '10',
        MESHY_API_KEY: mock.keys.meshy,
        GEN_MESHY_BASE_URL: mock.meshyBase,
      },
      port: 0,
      timeScale: 0.002,
      log: createRedactingLogger((l) => lines.push(l)),
    });
    try {
      expect(await (await fetch(`${gw.url}/healthz`)).text()).toBe('ok');
      const client = createGenerationClient({ baseUrl: gw.url, pollMs: 5 });
      const providers = await client.providers();
      expect(providers.providers.find((p) => p.id === 'tripo')?.configured).toBe(false);
      const up = await client.upload(makePng(), 'image/png');
      const job = await client.submit({
        provider: 'meshy',
        op: 'image-to-model',
        images: [{ upload: up.upload }],
        params: { faceLimit: 800 },
        idempotencyKey: 'standalone-0123456789',
        maxCostUsd: 1,
        attestation: { tier: 'paid' },
      });
      const states: string[] = [];
      const done = await new Promise<string>((resolve, reject) => {
        const w = client.watch(
          job.id,
          (j) => {
            states.push(j.state);
            if (isTerminal(j.state)) {
              w.close();
              resolve(j.state);
            }
          },
          reject,
        );
      });
      expect(done).toBe('succeeded');
      expect(states.at(-1)).toBe('succeeded');
      // A request through a proxy (X-Forwarded-For) is refused in loopback mode.
      expect((await fetch(`${gw.url}/v1/providers`, { headers: { 'x-forwarded-for': '203.0.113.1' } })).status).toBe(
        401,
      );
    } finally {
      await gw.close();
      await mock.close();
    }
  });

  it('refuses to start: keys without auth on a public bind (CLI exits 78, no secret printed)', async () => {
    await expect(
      startStandaloneGateway({
        env: {
          GEN_GATEWAY_ENABLED: '1',
          GEN_GATEWAY_HOST: '0.0.0.0',
          GEN_CAP_DAILY_USD: '1',
          GEN_CAP_MONTHLY_USD: '1',
          TRIPO_API_KEY: 'tsk_secret_value_123',
        },
        port: 0,
      }),
    ).rejects.toBeInstanceOf(GatewayConfigError);
    const run = spawnSync(process.execPath, [MAIN], {
      env: {
        PATH: process.env['PATH'] ?? '',
        GEN_GATEWAY_ENABLED: '1',
        GEN_GATEWAY_HOST: '0.0.0.0',
        GEN_CAP_DAILY_USD: '1',
        GEN_CAP_MONTHLY_USD: '1',
        TRIPO_API_KEY: 'tsk_secret_value_123',
      },
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(run.status).toBe(78);
    expect(run.stderr).toContain('Refusing to start');
    expect(run.stderr).toContain('TRIPO_API_KEY');
    expect(run.stderr).not.toContain('tsk_secret_value_123');
    const disabled = spawnSync(process.execPath, [MAIN], {
      env: { PATH: process.env['PATH'] ?? '' },
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(disabled.status).toBe(78);
    expect(disabled.stderr).toContain('GEN_GATEWAY_ENABLED=1');
  });
});

describe('redacting logger', () => {
  it('masks known secrets, bearer values, key-like query parameters and sensitive fields', () => {
    const lines: string[] = [];
    const log = createRedactingLogger((l) => lines.push(l), ['server-secret-value']);
    log.addSecret('byo-secret-value');
    log.log('info', 'call server-secret-value', {
      url: 'https://cdn.example/model.glb?Expires=1&X-Amz-Signature=abcdef&api_key=zzz',
      headers: { authorization: 'Bearer abc.def', 'x-gen-provider-key': 'anything' },
      prompt: 'my secret idea',
      nested: { error: new Error('failed with byo-secret-value') },
      note: 'Bearer xyz123',
    });
    log.log('debug', 'hidden');
    expect(lines).toHaveLength(1);
    const line = lines[0] as string;
    for (const s of [
      'server-secret-value',
      'byo-secret-value',
      'abcdef',
      'zzz',
      'abc.def',
      'anything',
      'my secret idea',
      'xyz123',
    ])
      expect(line).not.toContain(s);
    expect(line).toContain(REDACTED);
    expect(line).toContain('Expires=1');
  });
});
