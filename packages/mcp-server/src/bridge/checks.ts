// Upgrade checks of the bridge (MCP-SPEC §5.10, §5.19 T1–T3): before the WebSocket handshake completes, `Host` must be
// a loopback literal with the server's own port (DNS-rebinding defence) and `Origin` must be present (non-browser local
// processes are refused) and allow-listed (exact `scheme://host[:port]`, or `scheme://host:*` for every port).

/** The editor's hosted origin (M4a): compiled into the default allow-list next to the local dev origins. */
export const HOSTED_EDITOR_ORIGIN = 'https://studio.ekza.io';

/** True when `host` is `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>` (case-insensitive). */
export function hostAllowed(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  const value = host.trim().toLowerCase();
  return value === `127.0.0.1:${port}` || value === `localhost:${port}` || value === `[::1]:${port}`;
}

/** True when the browser-serialised `origin` is on the list (exact, or a `:*` entry for its scheme and host). */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (origin === undefined || origin === '' || origin === 'null') return false;
  const value = origin.trim().toLowerCase();
  for (const entry of allowed) {
    const rule = entry.toLowerCase();
    if (rule === value) return true;
    if (rule.endsWith(':*')) {
      const base = rule.slice(0, -2);
      if (value === base) return true;
      if (value.startsWith(`${base}:`) && /^\d{1,5}$/.test(value.slice(base.length + 1))) return true;
    }
  }
  return false;
}

/** Why an upgrade was refused (one stderr line per reason per 10 s, §5.10). */
export type UpgradeRefusal = 'host' | 'origin-missing' | 'origin' | 'path' | 'full';

/** The upgrade decision: null admits it; otherwise the HTTP status and the reason. */
export function checkUpgrade(
  headers: { readonly host?: string | undefined; readonly origin?: string | undefined },
  port: number,
  allowed: readonly string[],
): { readonly status: 403; readonly reason: UpgradeRefusal } | null {
  if (!hostAllowed(headers.host, port)) return { status: 403, reason: 'host' };
  if (headers.origin === undefined || headers.origin === '') return { status: 403, reason: 'origin-missing' };
  if (!originAllowed(headers.origin, allowed)) return { status: 403, reason: 'origin' };
  return null;
}

/** Rate-limits refusal lines: one per reason per `windowMs`, with the count of the ones held back. */
export function refusalLogger(
  write: (line: string) => void,
  windowMs = 10_000,
  now: () => number = Date.now,
): (reason: UpgradeRefusal, detail: string) => void {
  const last = new Map<UpgradeRefusal, { at: number; held: number }>();
  return (reason, detail) => {
    const entry = last.get(reason);
    const t = now();
    if (entry !== undefined && t - entry.at < windowMs) {
      entry.held += 1;
      return;
    }
    const held = entry?.held ?? 0;
    last.set(reason, { at: t, held: 0 });
    write(`bridge refused an upgrade (${reason}): ${detail}${held > 0 ? ` (+${held} more)` : ''}`);
  };
}
