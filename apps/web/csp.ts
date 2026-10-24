// The app's Content-Security-Policy (M7 G-b, ADR 0017 §1, MODELING-PLAN §3.11). Server builds send it as a response
// header (`next.config.ts` › `headers()`); static exports carry it as a `<meta http-equiv>` tag (`app/layout.tsx`),
// which cannot hold `frame-ancestors`. `connect-src` lists only this origin, local data/blob URLs, the agent bridge
// on loopback (MCP-SPEC §4.5) and the generation gateway's origin fixed at build time — never a provider origin.
//
// Next.js renders inline bootstrap scripts without nonces in statically rendered pages, so `script-src` keeps
// 'unsafe-inline'; WebAssembly (Draco, KTX2, meshoptimizer) needs 'wasm-unsafe-eval'; the three.js loaders start
// their workers from blob: URLs. 'unsafe-eval' is added only for `next dev`.

/** Build-time setting: the generation gateway's base URL (`https://gen.example.org` or a path such as `/api/gen`). */
export const GATEWAY_URL_ENV = 'STUDIO_GEN_GATEWAY_URL';

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

/**
 * The gateway origin to allow in `connect-src`: null for a same-origin path or no setting; throws on anything but
 * https (or http on loopback, for local development).
 */
export function gatewayOrigin(url: string | undefined): string | null {
  const raw = (url ?? '').trim();
  if (raw === '' || raw.startsWith('/')) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${GATEWAY_URL_ENV} is not a URL or an absolute path: ${raw}`);
  }
  if (u.username !== '' || u.password !== '') throw new Error(`${GATEWAY_URL_ENV} must not carry credentials.`);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.test(u.hostname)))
    throw new Error(`${GATEWAY_URL_ENV} must use https (or http on localhost).`);
  return u.origin;
}

export interface CspOptions {
  readonly dev: boolean;
  readonly gatewayOrigin: string | null;
  /** The header form adds `frame-ancestors` (ignored in a meta tag). */
  readonly header: boolean;
}

export function buildCsp(o: CspOptions): string {
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(o.dev ? ["'unsafe-eval'"] : [])]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['font-src', ["'self'", 'data:']],
    [
      'connect-src',
      [
        "'self'",
        'data:',
        'blob:',
        'ws://127.0.0.1:*',
        'ws://localhost:*',
        ...(o.gatewayOrigin === null ? [] : [o.gatewayOrigin]),
      ],
    ],
    ['media-src', ["'self'", 'data:', 'blob:']],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ...(o.header ? ([['frame-ancestors', ["'self'"]]] as [string, string[]][]) : []),
  ];
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}
