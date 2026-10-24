import { buildCsp, gatewayOrigin } from '../csp';

describe('CSP (M7 G-b)', () => {
  it('takes the gateway origin from the build-time URL, refusing anything but https (or http on localhost)', () => {
    expect(gatewayOrigin(undefined)).toBeNull();
    expect(gatewayOrigin('/api/gen')).toBeNull();
    expect(gatewayOrigin('https://gen.dev.ekza.io/v1/')).toBe('https://gen.dev.ekza.io');
    expect(gatewayOrigin('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(() => gatewayOrigin('http://gen.example.org')).toThrow(/https/);
    expect(() => gatewayOrigin('https://user:pw@gen.example.org')).toThrow(/credentials/);
    expect(() => gatewayOrigin('gen.example.org')).toThrow(/not a URL/);
  });

  it('lists only self, local URLs, the loopback agent bridge and the gateway in connect-src', () => {
    const csp = buildCsp({ dev: false, gatewayOrigin: 'https://gen.dev.ekza.io', header: true });
    expect(csp).toContain("connect-src 'self' data: blob: ws://127.0.0.1:* ws://localhost:* https://gen.dev.ekza.io;");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    const meta = buildCsp({ dev: false, gatewayOrigin: null, header: false });
    expect(meta).not.toContain('frame-ancestors');
    expect(meta).toContain("connect-src 'self' data: blob: ws://127.0.0.1:* ws://localhost:*;");
    expect(buildCsp({ dev: true, gatewayOrigin: null, header: true })).toContain("'unsafe-eval'");
  });
});
