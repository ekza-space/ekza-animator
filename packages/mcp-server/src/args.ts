// Command-line arguments (MCP-SPEC §5.22.2). Testing-only flags are accepted but not listed in --help.
import { isAbsolute, resolve } from 'node:path';
import { configWithDefaults, DEFAULT_ALLOWED_ORIGINS, type McpServerConfig } from './config';

export const USAGE = `ekza-animator-mcp [options]                  stdio MCP server (default)
  --workspace <dir>       read-write root (default: $CLAUDE_PROJECT_DIR, else the current folder; file tools stay off
                          when such a default is /, the home folder or a system folder)
  --allow-dir <dir>       extra read-only root (repeatable)
  --samples-dir <dir>     folder with seed-san.vrm / quaternius-ual.glb (the repository's fixtures/ layout works)
  --bridge-port <n>       fixed bridge port (0 = ephemeral; default: first free of 47821–47830)
  --no-bridge             headless only
  --allow-origin <o>      extra editor origin for the bridge (repeatable; also EKZA_MCP_ALLOWED_ORIGINS); default:
                          the editor's own origins only (http://localhost:3000, 127.0.0.1:3000, [::1]:3000)
  --http <host:port>      also serve Streamable HTTP; host must be 127.0.0.1 or localhost; one principal
  --token-file <path>     HTTP bearer token from a file (default: EKZA_MCP_TOKEN, else a random token written to a
                          0600 file whose path is printed to stderr)
  --max-projects <n>      open headless projects (default 4)
  --validate              validate exports with gltf-validator when it is installed
  --audit-log <file>      append one JSON line per call (no document data)
  --log-level <level>     error | warn | info (default) | debug, to stderr
  --seed <n>              seeded ids, one headless project (tests and evals)
  --version | --help
`;

export type ParsedArgs =
  | {
      readonly kind: 'serve';
      readonly config: McpServerConfig;
      readonly httpRequested: string | null;
      readonly tokenFile: string | null;
      /** stderr warnings about risky allowed origins (§5.10); the CLI prints them at the warn level. */
      readonly warnings: readonly string[];
    }
  | { readonly kind: 'version' }
  | { readonly kind: 'help' }
  | { readonly kind: 'error'; readonly message: string };

const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;

/** `scheme://host[:port]` (§5.10): http(s), a DNS name, an IPv4 address or a bracketed IPv6 address, a port or `*`. */
const ORIGIN =
  /^(https?):\/\/(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)(?::(\d{1,5}|\*))?\/?$/i;
const LOOPBACK_HOST = /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\])$/;
const GATEWAY_HOST = /(^|[.-])(ipfs|ipns|gateway)([.-]|$)/;
const DEFAULT_PORTS: Readonly<Record<string, string>> = { http: '80', https: '443' };

/**
 * An allowed bridge origin as the browser sends it (§5.10): exact `scheme://host[:port]`, `*` only as the whole port;
 * scheme and host lower-cased, a default port and one trailing slash dropped. Anything else (`*`, `null`, a path, a
 * query, credentials, another scheme) is an error.
 */
export function parseOrigin(text: string): { readonly origin: string } | { readonly error: string } {
  const match = ORIGIN.exec(text.trim());
  if (match === null) {
    return {
      error: `allowed origin ${JSON.stringify(text.slice(0, 80))} is not scheme://host[:port] (http or https; '*' only as the whole port)`,
    };
  }
  const scheme = (match[1] as string).toLowerCase();
  const host = (match[2] as string).toLowerCase();
  const port = match[3];
  if (port !== undefined && port !== '*' && (Number(port) < 1 || Number(port) > 65_535)) {
    return { error: `allowed origin ${text.trim()} has a port outside 1…65535` };
  }
  const shown = port === undefined || port === DEFAULT_PORTS[scheme] ? '' : `:${port}`;
  return { origin: `${scheme}://${host}${shown}` };
}

/** The warnings §5.10 asks for: plain http off loopback, a `*` port, a shared (path-based) gateway host. */
export function originWarnings(origin: string): string[] {
  const match = ORIGIN.exec(origin);
  if (match === null) return [];
  const [, scheme, host, port] = match as unknown as [string, string, string, string | undefined];
  const warnings: string[] = [];
  if (scheme === 'http' && !LOOPBACK_HOST.test(host)) {
    warnings.push(
      `allowed origin ${origin} is plain http off this computer: anyone on that network path can serve a page that pairs as the editor`,
    );
  }
  if (port === '*') {
    warnings.push(
      `allowed origin ${origin} admits every port on ${host}: any local dev server there can pose as the editor`,
    );
  }
  if (GATEWAY_HOST.test(host)) {
    warnings.push(
      `allowed origin ${origin} looks like a shared gateway: every site served from it shares the origin and can pose as the editor`,
    );
  }
  return warnings;
}

function int(value: string | undefined, flag: string, min: number, max: number): number | string {
  if (value === undefined || !/^\d+$/.test(value)) return `${flag} needs an integer`;
  const n = Number(value);
  return n < min || n > max ? `${flag} must be ${min}…${max}` : n;
}

/** Parses argv (without node and the script) and the environment into a configuration. */
export function parseArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): ParsedArgs {
  let workspace: string | null = null;
  const readOnlyRoots: string[] = [];
  let samplesDir: string | null = null;
  let bridgeEnabled = true;
  let bridgePort: number | null = null;
  const origins: string[] = [...DEFAULT_ALLOWED_ORIGINS];
  let http: string | null = null;
  let tokenFile: string | null = null;
  let maxProjects = 4;
  let validate = false;
  let auditLog: string | null = null;
  let logLevel: McpServerConfig['logLevel'] = 'info';
  let seed: number | null = null;
  const testing: { pairingTtlMs?: number; pairingLockoutMs?: number; resumeWindowMs?: number } = {};
  const warnings: string[] = [];
  const allow = (text: string, from: string): string | null => {
    const parsed = parseOrigin(text);
    if ('error' in parsed) return `${from}: ${parsed.error}`;
    if (!origins.includes(parsed.origin)) {
      origins.push(parsed.origin);
      warnings.push(...originWarnings(parsed.origin));
    }
    return null;
  };
  for (const origin of (env['EKZA_MCP_ALLOWED_ORIGINS'] ?? '').split(',')) {
    if (origin.trim() === '') continue;
    const error = allow(origin, 'EKZA_MCP_ALLOWED_ORIGINS');
    if (error !== null) return { kind: 'error', message: error };
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] as string;
    const value = argv[i + 1];
    const take = (): string | null => {
      if (value === undefined || value.startsWith('--')) return null;
      i++;
      return value;
    };
    switch (flag) {
      case '--version':
        return { kind: 'version' };
      case '--help':
        return { kind: 'help' };
      case '--no-bridge':
        bridgeEnabled = false;
        break;
      case '--validate':
        validate = true;
        break;
      case '--workspace':
      case '--allow-dir':
      case '--samples-dir':
      case '--allow-origin':
      case '--http':
      case '--token-file':
      case '--audit-log': {
        const text = take();
        if (text === null) return { kind: 'error', message: `${flag} needs a value` };
        if (flag === '--workspace') workspace = resolve(cwd, text);
        else if (flag === '--allow-dir') readOnlyRoots.push(resolve(cwd, text));
        else if (flag === '--samples-dir') samplesDir = resolve(cwd, text);
        else if (flag === '--allow-origin') {
          const error = allow(text, '--allow-origin');
          if (error !== null) return { kind: 'error', message: error };
        } else if (flag === '--http') http = text;
        else if (flag === '--token-file') tokenFile = resolve(cwd, text);
        else auditLog = resolve(cwd, text);
        break;
      }
      case '--log-level': {
        const level = take();
        if (level === null || !(LOG_LEVELS as readonly string[]).includes(level)) {
          return { kind: 'error', message: '--log-level must be error, warn, info or debug' };
        }
        logLevel = level as McpServerConfig['logLevel'];
        break;
      }
      case '--bridge-port':
      case '--max-projects':
      case '--seed':
      case '--pairing-ttl-ms':
      case '--pairing-lockout-ms':
      case '--resume-window-ms': {
        const max = flag === '--bridge-port' ? 65_535 : flag === '--max-projects' ? 64 : 2_147_483_647;
        const n = int(take() ?? undefined, flag, flag === '--max-projects' ? 1 : 0, max);
        if (typeof n === 'string') return { kind: 'error', message: n };
        if (flag === '--bridge-port') bridgePort = n;
        else if (flag === '--max-projects') maxProjects = n;
        else if (flag === '--seed') seed = n;
        else if (flag === '--pairing-ttl-ms') testing.pairingTtlMs = n;
        else if (flag === '--pairing-lockout-ms') testing.pairingLockoutMs = n;
        else testing.resumeWindowMs = n;
        break;
      }
      default:
        return { kind: 'error', message: `unknown option ${flag.slice(0, 40)}` };
    }
  }
  const fromEnv = env['CLAUDE_PROJECT_DIR'];
  const source: McpServerConfig['workspaceSource'] =
    workspace !== null ? 'flag' : fromEnv !== undefined && fromEnv !== '' && isAbsolute(fromEnv) ? 'env' : 'cwd';
  const root = workspace ?? (source === 'env' ? (fromEnv as string) : cwd);
  const base = configWithDefaults({ workspace: root });
  const config: McpServerConfig = {
    ...base,
    workspaceSource: source,
    readOnlyRoots,
    samplesDir,
    bridge: { ...base.bridge, ...testing, enabled: bridgeEnabled, port: bridgePort, allowedOrigins: origins },
    maxProjects,
    validate,
    auditLog,
    logLevel,
    seed,
  };
  return { kind: 'serve', config, httpRequested: http, tokenFile, warnings };
}
