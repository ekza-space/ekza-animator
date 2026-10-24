import { createGenerationClient, sha256Hex } from '@ekza-studio/gen-core';
import { checkGlb, checkImage, createGateway, defaultAdapters, loadGatewayConfig, providerEnvs } from '../src/index.ts';
import { makeCubeGlb, makeJpegHeader, makePng, makeWebpHeader } from '../src/testing/index.ts';
import { setup, TOKEN, urlOf } from './helpers.ts';

const bearer = { authorization: `Bearer ${TOKEN}` };

describe('auth and routing', () => {
  it('requires the bearer token; never echoes secrets in /v1/providers', async () => {
    const s = await setup();
    try {
      expect((await s.fetch('/api/gen/v1/providers')).status).toBe(401);
      expect((await s.fetch('/api/gen/v1/providers', { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
      const res = await s.fetch('/api/gen/v1/providers', { headers: bearer });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const text = await res.text();
      for (const secret of [TOKEN, s.mock.keys.tripo, s.mock.keys.meshy, s.mock.origin])
        expect(text).not.toContain(secret);
      const body = JSON.parse(text) as { protocol: string; providers: { id: string; configured: boolean }[] };
      expect(body.protocol).toBe('ekza-gen/v1');
      expect(body.providers.map((p) => [p.id, p.configured])).toEqual([
        ['tripo', true],
        ['meshy', true],
      ]);
      expect((await s.fetch('/api/gen/v2/providers', { headers: bearer })).status).toBe(404);
      expect((await s.fetch('/other/v1/providers', { headers: bearer })).status).toBe(404);
    } finally {
      await s.close();
    }
  });

  it('loopback mode refuses remote peers, proxied requests and non-loopback Host headers (DNS rebinding)', async () => {
    const env = {
      GEN_GATEWAY_ENABLED: '1',
      GEN_CAP_DAILY_USD: '1',
      GEN_CAP_MONTHLY_USD: '1',
      GEN_GATEWAY_HOST: '127.0.0.1',
    };
    const adapters = defaultAdapters();
    const gw = createGateway({ config: loadGatewayConfig(env, 'standalone', providerEnvs(adapters)), adapters });
    const call = (host: string, remote: string, extra?: Record<string, string>): Promise<Response> =>
      gw.handle(new Request(`http://${host}/v1/providers`, { headers: { host, ...extra } }), { remoteAddress: remote });
    expect((await call('127.0.0.1:8787', '127.0.0.1')).status).toBe(200);
    expect((await call('localhost:8787', '::ffff:127.0.0.1')).status).toBe(200);
    expect((await call('127.0.0.1:8787', '203.0.113.9')).status).toBe(401);
    expect((await call('127.0.0.1:8787', '127.0.0.1', { 'x-forwarded-for': '203.0.113.9' })).status).toBe(401);
    expect((await call('attacker.example:8787', '127.0.0.1')).status).toBe(401);
    await gw.close();
  });

  it('answers CORS only for the configured origins and refuses unsafe calls from other origins', async () => {
    const s = await setup({ env: { GEN_ALLOWED_ORIGINS: 'https://studio.example' } });
    try {
      const pre = await s.fetch('/api/gen/v1/jobs', {
        method: 'OPTIONS',
        headers: { origin: 'https://studio.example' },
      });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBe('https://studio.example');
      expect(pre.headers.get('access-control-allow-headers')).toContain('x-gen-provider-key');
      const bad = await s.fetch('/api/gen/v1/jobs', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
      expect(bad.status).toBe(404);
      const forged = await s.fetch('/api/gen/v1/uploads', {
        method: 'POST',
        headers: { ...bearer, origin: 'https://evil.example', 'content-type': 'image/png' },
        body: makePng() as Uint8Array<ArrayBuffer>,
      });
      expect(forged.status).toBe(401);
      const ok = await s.fetch('/api/gen/v1/providers', { headers: { ...bearer, origin: 'https://studio.example' } });
      expect(ok.headers.get('access-control-allow-origin')).toBe('https://studio.example');
    } finally {
      await s.close();
    }
  });

  it('hides webhooks unless a public URL (and for Tripo a secret) is configured', async () => {
    const s = await setup();
    try {
      expect((await s.fetch('/api/gen/v1/hooks/tripo', { method: 'POST', body: '{}' })).status).toBe(404);
    } finally {
      await s.close();
    }
  });
});

describe('uploads (§7.2: ≤ 20 MB, real type, no EXIF/XMP)', () => {
  it('accepts clean images and GLBs, and returns their hashes', async () => {
    const s = await setup();
    try {
      const png = makePng(80, 64);
      const up = await s.client.upload(png, 'image/png');
      expect(up).toMatchObject({
        mime: 'image/png',
        size: png.length,
        width: 80,
        height: 64,
        sha256: await sha256Hex(png),
      });
      const glb = await s.client.upload(makeCubeGlb(), 'model/gltf-binary');
      expect(glb.width).toBeNull();
    } finally {
      await s.close();
    }
  });

  it('rejects metadata, type mismatches, size and external GLB references', async () => {
    const s = await setup({ env: { GEN_UPLOAD_MAX_BYTES: '4096' } });
    try {
      const post = (bytes: Uint8Array, type: string): Promise<Response> =>
        s.fetch('/api/gen/v1/uploads', {
          method: 'POST',
          headers: { ...bearer, 'content-type': type },
          body: bytes as Uint8Array<ArrayBuffer>,
        });
      const code = async (r: Promise<Response>): Promise<[number, string]> => {
        const res = await r;
        const body = (await res.json()) as { error: { code: string } };
        return [res.status, body.error.code];
      };
      expect(await code(post(makePng(64, 64, 'exif'), 'image/png'))).toEqual([400, 'invalid-request']);
      expect(await code(post(makePng(64, 64, 'xmp'), 'image/png'))).toEqual([400, 'invalid-request']);
      expect(await code(post(makeJpegHeader(64, 64, true), 'image/jpeg'))).toEqual([400, 'invalid-request']);
      expect(await code(post(makeWebpHeader(64, 64, true), 'image/webp'))).toEqual([400, 'invalid-request']);
      expect(await code(post(makePng(), 'image/jpeg'))).toEqual([415, 'unsupported-media']);
      expect(await code(post(makePng(), 'image/gif'))).toEqual([415, 'unsupported-media']);
      expect(await code(post(makePng(32, 32), 'image/png'))).toEqual([400, 'invalid-request']);
      expect(await code(post(new Uint8Array(5000), 'image/png'))).toEqual([413, 'payload-too-large']);
      const glb = makeCubeGlb();
      const json = JSON.parse(
        new TextDecoder().decode(glb.subarray(20, 20 + new DataView(glb.buffer).getUint32(12, true))),
      ) as { buffers: { uri?: string }[] };
      (json.buffers[0] as { uri?: string }).uri = 'https://example.com/steal.bin';
      const text = new TextEncoder().encode(JSON.stringify(json));
      const padded = new Uint8Array((text.length + 3) & ~3).fill(0x20);
      padded.set(text);
      const bin = glb.subarray(20 + new DataView(glb.buffer).getUint32(12, true));
      const out = new Uint8Array(20 + padded.length + bin.length);
      out.set(glb.subarray(0, 20));
      out.set(padded, 20);
      out.set(bin, 20 + padded.length);
      const dv = new DataView(out.buffer);
      dv.setUint32(8, out.length, true);
      dv.setUint32(12, padded.length, true);
      expect(() => checkGlb(out)).toThrow(/uri/);
      expect(await code(post(out, 'model/gltf-binary'))).toEqual([400, 'invalid-request']);
    } finally {
      await s.close();
    }
  });

  it('reads image sizes from PNG, JPEG and WebP', () => {
    expect(checkImage(makePng(100, 70), 'image/png')).toEqual({ mime: 'image/png', width: 100, height: 70 });
    expect(checkImage(makeJpegHeader(300, 200), 'image/jpeg')).toEqual({ mime: 'image/jpeg', width: 300, height: 200 });
    expect(checkImage(makeWebpHeader(128, 96), 'image/webp')).toEqual({ mime: 'image/webp', width: 128, height: 96 });
  });

  it('the typed client works against the handler through its own fetch', async () => {
    const s = await setup();
    try {
      const client = createGenerationClient({ baseUrl: '/api/gen', fetch: (i, init) => s.fetch(urlOf(i), init) });
      await expect(client.providers()).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
      expect((await s.client.providers()).caps).toEqual({
        dailyUsd: 5,
        monthlyUsd: 20,
        remainingDailyUsd: 5,
        remainingMonthlyUsd: 20,
      });
    } finally {
      await s.close();
    }
  });
});
