// Discovery (MCP-SPEC §5.10): the tab tries the given ports (or 47821–47830) in parallel, 1,500 ms each, sends `hello`
// (the toolset and app version only — nothing about the tab or its project before `pair.ok`) and lists every server
// that answers. A refused upgrade (403, an origin the server does not allow) looks like "nothing answers" to the page.
// Chrome's Local Network Access asks the user before an https page reaches ws://127.0.0.1; a refusal looks the same, so
// `lnaState()` reads the permission where the browser exposes it.
import { BRIDGE_PORTS, type BridgeMessage } from '@ekza-studio/agent-tools';
import { openTabSocket, type TabSocket } from './socket';

export const PROBE_TIMEOUT_MS = 1_500;

export type ProbeAnswer =
  | { readonly kind: 'ok'; readonly socket: TabSocket; readonly hello: Extract<BridgeMessage, { t: 'hello.ok' }> }
  | { readonly kind: 'refused'; readonly port: number; readonly message: string };

/** The default ports, or the ones given (`?agentPort=`). */
export function probePorts(ports: readonly number[]): readonly number[] {
  if (ports.length > 0) return ports;
  const out: number[] = [];
  for (let p = BRIDGE_PORTS.first; p <= BRIDGE_PORTS.last; p++) out.push(p);
  return out;
}

async function probeOne(
  port: number,
  hello: Extract<BridgeMessage, { t: 'hello' }>,
  timeoutMs: number,
): Promise<ProbeAnswer | null> {
  let socket: TabSocket;
  try {
    socket = await openTabSocket(port, timeoutMs);
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.close();
      resolve(null);
    }, timeoutMs);
    socket.onMessage((message) => {
      if (message.t === 'hello.ok') {
        clearTimeout(timer);
        resolve({ kind: 'ok', socket, hello: message });
      } else if (message.t === 'hello.refused') {
        clearTimeout(timer);
        socket.close();
        resolve({ kind: 'refused', port, message: message.message });
      }
    });
    socket.onClose(() => {
      clearTimeout(timer);
      resolve(null);
    });
    socket.send(hello);
  });
}

/** Every server that answered, in port order. */
export async function discoverServers(
  ports: readonly number[],
  hello: Extract<BridgeMessage, { t: 'hello' }>,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<readonly ProbeAnswer[]> {
  const answers = await Promise.all(probePorts(ports).map((port) => probeOne(port, hello, timeoutMs)));
  return answers.filter((answer): answer is ProbeAnswer => answer !== null);
}

/** Chrome's Local Network Access permission, where `navigator.permissions` knows it; null elsewhere. */
export async function lnaState(): Promise<'granted' | 'denied' | 'prompt' | null> {
  try {
    const status = await navigator.permissions.query({ name: 'local-network-access' as PermissionName });
    return status.state;
  } catch {
    return null;
  }
}

/** True when the page itself is served from loopback (no Local Network Access prompt applies). */
export function pageIsLoopback(): boolean {
  const host = globalThis.location?.hostname ?? '';
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}
