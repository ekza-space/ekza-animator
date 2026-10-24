// Gateway configuration from the server environment and the default-deny rules (ADR 0017 §2–§3, MODELING-PLAN
// §3.11, Q-GEN-10):
// - the gateway exists only with GEN_GATEWAY_ENABLED=1 (otherwise every path is a plain 404);
// - enabled, it needs an auth: a shared bearer token (GEN_GATEWAY_TOKEN, ≥ 32 characters), a session verifier passed
//   by the host (accounts, M4b), or — standalone only — a loopback-only bind; it refuses to start otherwise, and says
//   so louder when provider keys are set;
// - daily and monthly spend caps (USD) are required and apply to every mode, whatever the client asks.
// Nothing here is read in the browser: the variable names below must never reach a client bundle (CI check).

export class GatewayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayConfigError';
  }
}

export type Env = Readonly<Record<string, string | undefined>>;
export type MountMode = 'next' | 'standalone';

export interface ProviderEnv {
  readonly id: string;
  readonly keyEnv: string; // e.g. TRIPO_API_KEY
  readonly baseUrlEnv: string; // e.g. GEN_TRIPO_BASE_URL (tests, the mock provider server)
  readonly webhookSecretEnv: string | null;
}

export interface ProviderSettings {
  readonly id: string;
  readonly key: string | null;
  readonly baseUrl: string | null; // override; null = the adapter's default origin
  readonly webhookSecret: string | null;
}

export type AuthMode =
  | { readonly kind: 'token'; readonly token: string }
  | { readonly kind: 'loopback' }
  | { readonly kind: 'session' };

export interface GatewayConfig {
  readonly enabled: true;
  readonly mode: MountMode;
  readonly auth: AuthMode;
  readonly caps: { readonly dailyUsd: number; readonly monthlyUsd: number };
  readonly paused: boolean;
  readonly byoKeys: boolean;
  readonly allowedOrigins: readonly string[];
  readonly publicUrl: string | null; // webhooks reach `${publicUrl}/v1/hooks/<provider>`
  readonly providers: readonly ProviderSettings[];
  readonly dataDir: string | null;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly uploadMaxBytes: number;
  readonly artifactMaxBytes: number;
  readonly rate: { readonly jobsPerMinute: number; readonly uploadsPerMinute: number };
  readonly host: string; // standalone bind
  readonly port: number;
}

export type ConfigResult = { readonly enabled: false } | GatewayConfig;

export const MIN_TOKEN_CHARS = 32;
const MAX_UPLOAD = 20 * 1024 * 1024;
const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.includes(host) || /^127\.\d+\.\d+\.\d+$/.test(host);
}

function num(env: Env, name: string, fallback: number | null, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    if (fallback === null) throw new GatewayConfigError(`${name} is required when GEN_GATEWAY_ENABLED=1.`);
    return fallback;
  }
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min || v > max)
    throw new GatewayConfigError(`${name} must be a number ${min}…${max}.`);
  return v;
}

/** An origin for CORS or a base URL: https, or http on a loopback host (local development and tests). */
function checkUrl(name: string, raw: string, originOnly: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GatewayConfigError(`${name} is not a URL.`);
  }
  const local = url.protocol === 'http:' && isLoopbackHost(url.hostname.replace(/^\[|\]$/g, ''));
  if (url.protocol !== 'https:' && !local)
    throw new GatewayConfigError(`${name} must use https (or http on loopback).`);
  if (url.username !== '' || url.password !== '') throw new GatewayConfigError(`${name} must not carry credentials.`);
  if (originOnly) {
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '')
      throw new GatewayConfigError(`${name} must be an origin (scheme://host[:port]).`);
    return url.origin;
  }
  return url.href.replace(/\/+$/, '');
}

/**
 * Reads the gateway configuration. Throws `GatewayConfigError` — the server must not start — when the gateway is
 * enabled without an auth, with weak or missing settings, or with provider keys and no auth.
 */
export function loadGatewayConfig(
  env: Env,
  mode: MountMode,
  providers: readonly ProviderEnv[],
  opts?: { readonly session?: boolean },
): ConfigResult {
  if (env['GEN_GATEWAY_ENABLED'] !== '1') return { enabled: false };

  const keysSet = providers.filter((p) => (env[p.keyEnv] ?? '').trim() !== '').map((p) => p.keyEnv);
  const token = (env['GEN_GATEWAY_TOKEN'] ?? '').trim();
  const host = (env['GEN_GATEWAY_HOST'] ?? '127.0.0.1').trim();
  let auth: AuthMode;
  if (token !== '') {
    if (token.length < MIN_TOKEN_CHARS)
      throw new GatewayConfigError(`GEN_GATEWAY_TOKEN must be at least ${MIN_TOKEN_CHARS} characters.`);
    auth = { kind: 'token', token };
  } else if (opts?.session === true) {
    auth = { kind: 'session' };
  } else if (mode === 'standalone' && isLoopbackHost(host)) {
    auth = { kind: 'loopback' };
  } else {
    const why =
      keysSet.length > 0
        ? `provider keys are set (${keysSet.join(', ')}) but the gateway has no auth`
        : 'the gateway is enabled without an auth';
    const how =
      mode === 'next'
        ? 'set GEN_GATEWAY_TOKEN (a route inside the web server cannot prove a loopback-only bind)'
        : 'set GEN_GATEWAY_TOKEN or bind to a loopback address (GEN_GATEWAY_HOST=127.0.0.1)';
    throw new GatewayConfigError(`Refusing to start: ${why}; ${how}.`);
  }

  const dailyUsd = num(env, 'GEN_CAP_DAILY_USD', null, 0.01, 100_000);
  const monthlyUsd = num(env, 'GEN_CAP_MONTHLY_USD', null, 0.01, 1_000_000);
  if (dailyUsd > monthlyUsd) throw new GatewayConfigError('GEN_CAP_DAILY_USD must not exceed GEN_CAP_MONTHLY_USD.');

  const allowedOrigins = (env['GEN_ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((o) => checkUrl('GEN_ALLOWED_ORIGINS', o, true));
  const publicRaw = (env['GEN_PUBLIC_URL'] ?? '').trim();
  const publicUrl = publicRaw === '' ? null : checkUrl('GEN_PUBLIC_URL', publicRaw, false);
  if (publicUrl !== null && !publicUrl.startsWith('https:'))
    throw new GatewayConfigError('GEN_PUBLIC_URL must use https: providers deliver webhooks to it.');

  const settings: ProviderSettings[] = providers.map((p) => {
    const key = (env[p.keyEnv] ?? '').trim();
    const base = (env[p.baseUrlEnv] ?? '').trim();
    const secret = p.webhookSecretEnv === null ? '' : (env[p.webhookSecretEnv] ?? '').trim();
    return {
      id: p.id,
      key: key === '' ? null : key,
      baseUrl: base === '' ? null : checkUrl(p.baseUrlEnv, base, false),
      webhookSecret: secret === '' ? null : secret,
    };
  });

  const level = env['GEN_LOG_LEVEL'] ?? 'info';
  if (level !== 'debug' && level !== 'info' && level !== 'warn' && level !== 'error')
    throw new GatewayConfigError('GEN_LOG_LEVEL must be debug, info, warn or error.');

  return {
    enabled: true,
    mode,
    auth,
    caps: { dailyUsd, monthlyUsd },
    paused: env['GEN_GATEWAY_PAUSED'] === '1',
    byoKeys: env['GEN_BYO_KEYS'] === '1',
    allowedOrigins,
    publicUrl,
    providers: settings,
    dataDir: (env['GEN_DATA_DIR'] ?? '').trim() || null,
    logLevel: level,
    uploadMaxBytes: num(env, 'GEN_UPLOAD_MAX_BYTES', MAX_UPLOAD, 1024, MAX_UPLOAD),
    artifactMaxBytes: num(env, 'GEN_ARTIFACT_MAX_BYTES', 100 * 1024 * 1024, 1024 * 1024, 512 * 1024 * 1024),
    rate: {
      jobsPerMinute: num(env, 'GEN_RATE_JOBS_PER_MIN', 10, 1, 10_000),
      uploadsPerMinute: num(env, 'GEN_RATE_UPLOADS_PER_MIN', 30, 1, 10_000),
    },
    host,
    port: num(env, 'GEN_GATEWAY_PORT', 8787, 1, 65_535),
  };
}

/** Every secret value of a configuration, for the redacting logger. */
export function configSecrets(c: GatewayConfig): string[] {
  const out: string[] = [];
  if (c.auth.kind === 'token') out.push(c.auth.token);
  for (const p of c.providers) {
    if (p.key) out.push(p.key);
    if (p.webhookSecret) out.push(p.webhookSecret);
  }
  return out;
}
