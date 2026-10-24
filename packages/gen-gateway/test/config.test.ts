import { createGateway, defaultAdapters, GatewayConfigError, loadGatewayConfig, providerEnvs } from '../src/index.ts';

const providers = providerEnvs(defaultAdapters());
const caps = { GEN_CAP_DAILY_USD: '5', GEN_CAP_MONTHLY_USD: '50' };
const token = 'x'.repeat(40);

describe('default deny (ADR 0017 §2, Q-GEN-10)', () => {
  it('is disabled unless GEN_GATEWAY_ENABLED=1, even with provider keys set', () => {
    expect(loadGatewayConfig({ TRIPO_API_KEY: 'tsk_live_secret' }, 'next', providers)).toEqual({ enabled: false });
    expect(loadGatewayConfig({ GEN_GATEWAY_ENABLED: 'true', ...caps }, 'next', providers)).toEqual({ enabled: false });
  });

  it('a disabled gateway answers 404 on every path and method', async () => {
    const gw = createGateway({ config: { enabled: false }, adapters: defaultAdapters(), basePath: '/api/gen' });
    for (const [method, path] of [
      ['GET', '/api/gen/v1/providers'],
      ['POST', '/api/gen/v1/jobs'],
      ['POST', '/api/gen/v1/hooks/tripo'],
      ['OPTIONS', '/api/gen/v1/jobs'],
      ['GET', '/api/gen/'],
    ] as const) {
      const res = await gw.handle(new Request(`http://localhost${path}`, { method }));
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.text()).toBe('Not Found');
    }
  });

  it('refuses to start with provider keys and no auth, naming the keys but not their values', () => {
    const env = { GEN_GATEWAY_ENABLED: '1', TRIPO_API_KEY: 'tsk_live_secret', ...caps };
    expect(() => loadGatewayConfig(env, 'next', providers)).toThrow(GatewayConfigError);
    const message = ((): string => {
      try {
        loadGatewayConfig(env, 'next', providers);
        return '';
      } catch (e) {
        return String(e);
      }
    })();
    expect(message).toContain('TRIPO_API_KEY');
    expect(message).not.toContain('tsk_live_secret');
    // Standalone on a public interface without a token: refused too.
    expect(() => loadGatewayConfig({ ...env, GEN_GATEWAY_HOST: '0.0.0.0' }, 'standalone', providers)).toThrow(
      /provider keys are set/,
    );
  });

  it('accepts a loopback-only bind only for the standalone server', () => {
    const env = { GEN_GATEWAY_ENABLED: '1', MESHY_API_KEY: 'msy_secret', ...caps };
    const c = loadGatewayConfig({ ...env, GEN_GATEWAY_HOST: '127.0.0.1' }, 'standalone', providers);
    expect(c.enabled && c.auth.kind).toBe('loopback');
    expect(() => loadGatewayConfig(env, 'next', providers)).toThrow(/cannot prove a loopback-only bind/);
  });

  it('needs a strong token and both caps, daily ≤ monthly', () => {
    const base = { GEN_GATEWAY_ENABLED: '1', GEN_GATEWAY_TOKEN: token };
    expect(() => loadGatewayConfig({ ...base, GEN_GATEWAY_TOKEN: 'short' }, 'next', providers)).toThrow(/at least 32/);
    expect(() => loadGatewayConfig(base, 'next', providers)).toThrow(/GEN_CAP_DAILY_USD is required/);
    expect(() => loadGatewayConfig({ ...base, GEN_CAP_DAILY_USD: '5' }, 'next', providers)).toThrow(
      /GEN_CAP_MONTHLY_USD is required/,
    );
    expect(() =>
      loadGatewayConfig({ ...base, GEN_CAP_DAILY_USD: '50', GEN_CAP_MONTHLY_USD: '5' }, 'next', providers),
    ).toThrow(/must not exceed/);
    const ok = loadGatewayConfig({ ...base, ...caps }, 'next', providers);
    expect(ok.enabled && ok.caps).toEqual({ dailyUsd: 5, monthlyUsd: 50 });
  });

  it('checks origins, the public URL and provider base URLs', () => {
    const base = { GEN_GATEWAY_ENABLED: '1', GEN_GATEWAY_TOKEN: token, ...caps };
    expect(() => loadGatewayConfig({ ...base, GEN_ALLOWED_ORIGINS: 'http://evil.example' }, 'next', providers)).toThrow(
      /https/,
    );
    expect(() =>
      loadGatewayConfig({ ...base, GEN_ALLOWED_ORIGINS: 'https://studio.example/path' }, 'next', providers),
    ).toThrow(/origin/);
    expect(() => loadGatewayConfig({ ...base, GEN_PUBLIC_URL: 'http://127.0.0.1:1' }, 'next', providers)).toThrow(
      /webhooks/,
    );
    expect(() =>
      loadGatewayConfig({ ...base, GEN_TRIPO_BASE_URL: 'http://provider.example/v3' }, 'next', providers),
    ).toThrow(/https/);
    const c = loadGatewayConfig(
      { ...base, GEN_ALLOWED_ORIGINS: 'https://studio.dev.ekza.io, http://localhost:3000' },
      'next',
      providers,
    );
    expect(c.enabled && c.allowedOrigins).toEqual(['https://studio.dev.ekza.io', 'http://localhost:3000']);
    expect(c.enabled && c.uploadMaxBytes).toBe(20 * 1024 * 1024);
    expect(() =>
      loadGatewayConfig({ ...base, GEN_UPLOAD_MAX_BYTES: String(30 * 1024 * 1024) }, 'next', providers),
    ).toThrow(GatewayConfigError);
  });
});
