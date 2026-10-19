// The server configuration (MCP-SPEC §4.6) and its defaults (§5.10, §5.17, §5.22.2).
import { BRIDGE_PORTS } from '@ekza-animator/agent-tools';

export interface McpServerConfig {
  readonly workspace: string; // absolute; read-write root
  readonly readOnlyRoots: readonly string[];
  readonly samplesDir: string | null;
  readonly workspaceSource: 'flag' | 'env' | 'cwd'; // where `workspace` came from (§5.17.3 refuses unsafe 'env'/'cwd' roots)
  readonly bridge: {
    readonly enabled: boolean;
    readonly port: number | null /* null: 47821–47830; 0: ephemeral */;
    readonly allowedOrigins: readonly string[] /* default §5.10 + --allow-origin */;
    readonly pairingTtlMs: number /* 120,000 */;
    readonly pairingLockoutMs: number /* 60,000 */;
    readonly resumeWindowMs: number /* 600,000 */;
    readonly maxUnpairedSockets: number /* 8 */;
  };
  readonly http: {
    readonly host: '127.0.0.1' | 'localhost';
    readonly port: number;
    readonly token: string;
    readonly tokenFile: string | null /* where a generated token was written (0600) */;
  } | null;
  readonly maxProjects: number; // 4
  readonly projectIdleMs: number; // 1,800,000
  readonly validate: boolean;
  readonly auditLog: string | null;
  readonly seed: number | null;
  readonly logLevel: 'error' | 'warn' | 'info' | 'debug';
}

/** The editor's own origins (§5.10): the only ones the bridge admits by default. */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://[::1]:3000',
];

export const DEFAULTS = {
  pairingTtlMs: 120_000,
  pairingLockoutMs: 60_000,
  resumeWindowMs: 600_000,
  maxUnpairedSockets: 8,
  maxProjects: 4,
  projectIdleMs: 1_800_000,
  bridgePorts: BRIDGE_PORTS,
} as const;

/** A complete configuration from a partial one (tests and the in-process server). */
export function configWithDefaults(
  partial: Partial<McpServerConfig> & { readonly workspace: string },
): McpServerConfig {
  return {
    readOnlyRoots: [],
    samplesDir: null,
    workspaceSource: 'flag',
    bridge: {
      enabled: false,
      port: null,
      allowedOrigins: DEFAULT_ALLOWED_ORIGINS,
      pairingTtlMs: DEFAULTS.pairingTtlMs,
      pairingLockoutMs: DEFAULTS.pairingLockoutMs,
      resumeWindowMs: DEFAULTS.resumeWindowMs,
      maxUnpairedSockets: DEFAULTS.maxUnpairedSockets,
    },
    http: null,
    maxProjects: DEFAULTS.maxProjects,
    projectIdleMs: DEFAULTS.projectIdleMs,
    validate: false,
    auditLog: null,
    seed: null,
    logLevel: 'info',
    ...partial,
  };
}
