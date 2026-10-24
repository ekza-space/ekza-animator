// The redacting logger (ADR 0017 §10, research 15 §5.7): structured JSON lines with every known secret value replaced,
// bearer/authorization values and key-like query parameters masked, and prompt text never written (callers log its
// hash). Secrets registered at runtime (BYO keys) are redacted for as long as the gateway lives.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  log(level: LogLevel, msg: string, fields?: LogFields): void;
  /** Adds a value to redact from every later line (a BYO key for the life of its job). */
  addSecret(value: string): void;
}

export type LogSink = (line: string) => void;

export const REDACTED = '[redacted]';

const SENSITIVE_KEYS = /^(authorization|x-gen-provider-key|api[-_]?key|token|secret|password|prompt|signature)$/i;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
const QUERY_SECRET = /([?&](?:api[-_]?key|key|token|signature|x-amz-signature|x-amz-credential)=)[^&\s"]+/gi;

export function createRedactingLogger(
  sink: LogSink,
  secrets: readonly string[] = [],
  minLevel: LogLevel = 'info',
): Logger {
  const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const known = new Set(secrets.filter((s) => s.length >= 8));
  const scrubString = (s: string): string => {
    let out = s.replace(BEARER, `$1 ${REDACTED}`).replace(QUERY_SECRET, `$1${REDACTED}`);
    for (const secret of known) if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    return out;
  };
  const scrub = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return scrubString(v);
    if (depth > 6 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
    if (v instanceof Error) return { name: v.name, message: scrubString(v.message) };
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = SENSITIVE_KEYS.test(k) ? REDACTED : scrub(x, depth + 1);
    return out;
  };
  return {
    log(level, msg, fields) {
      if (order[level] < order[minLevel]) return;
      const line = { t: new Date().toISOString(), level, msg: scrubString(msg), ...(scrub(fields ?? {}, 0) as object) };
      sink(JSON.stringify(line));
    },
    addSecret(value) {
      if (value.length >= 8) known.add(value);
    },
  };
}

/** A logger that writes nothing (tests). */
export const silentLogger: Logger = { log: () => undefined, addSecret: () => undefined };
