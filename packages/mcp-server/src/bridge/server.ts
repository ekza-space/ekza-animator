// The live bridge (MCP-SPEC §4.5, §5.8, §5.10, §5.19): a WebSocket server on 127.0.0.1 (first free of 47821–47830, a
// fixed `--bridge-port`, or 0 = ephemeral) that the editor tab opens. Upgrade checks (loopback `Host`, allow-listed
// `Origin`, ≤ 8 unpaired sockets), `hello` with the toolset handshake (major versions must match), server-generated
// one-time pairing codes claimed by `editor_connect` (the human approves the claim in the client and the grants in the
// tab), a 256-bit in-memory token, one paired tab per server, the call relay with deadlines (30 s, files 300 s, extended
// once by a confirm or redo card), cooperative cancellation (`cancel`), chunked blobs (1 MiB, ≤ 256 MiB per call) and
// server-side re-validation of every tab result (`results.ts`). Resume after an abnormal close is cut in the MVP
// (MCP-SPEC §0.4.2, M-AI-MVP-17): any close ends the pairing and the user pairs again.
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  type AgentImage,
  type AgentToolDef,
  type AgentToolResult,
  BRIDGE_CLOSE,
  BRIDGE_LIMITS,
  BRIDGE_PORTS,
  BRIDGE_PROTOCOL,
  type BridgeMessage,
  type ClientInfo,
  finishResult,
  type Grants,
  outputJsonSchemaOf,
  parseBridgeMessage,
  sanitizeText,
  serializeBridgeMessage,
  type ToolsetInfo,
  WAITING_FOR_CONFIRM,
  WAITING_FOR_REDO,
} from '@ekza-studio/agent-tools';
import type { RunActor } from '@ekza-studio/editor-core';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import type { McpServerConfig } from '../config';
import type { Logger } from '../log';
import { SERVER_VERSION } from '../version';
import { checkUpgrade, HOSTED_EDITOR_ORIGIN, refusalLogger } from './checks';
import {
  displayPairingCode,
  generatePairingCode,
  newSessionToken,
  normalizePairingCode,
  randomBase62,
  secretsEqual,
} from './codes';
import type { TabCallOptions, TabFileHooks, TabInfo, TabLink } from './link';
import { revalidateTabResult } from './results';

/** §5.8 7: deadlines measured from the server's receipt. */
export const BRIDGE_DEADLINES = { callMs: 30_000, filesMs: 300_000, connectMs: 50_000 } as const;
/** §5.10: a socket that sends no `hello` within this is closed; at most this many pending codes per server. */
export const HELLO_TIMEOUT_MS = 5_000;
export const MAX_PENDING_CODES = 4;
/** Five wrong codes within 60 s lock pairing (§5.10). */
export const WRONG_CODES_MAX = 5;
export const WRONG_CODES_WINDOW_MS = 60_000;
/** §5.10 keep-alive: a ping every 15 s; two missed pongs close the socket. */
export const PING_INTERVAL_MS = 15_000;
/** After `pair.ok` the tab reports its title and project; `editor_connect` waits this long for it. */
const TAB_REPORT_WAIT_MS = 5_000;

export interface BridgeServerOptions {
  readonly config: McpServerConfig['bridge'];
  readonly log: Logger;
  /** The server's toolset (`buildManifest()`): the editor's major version must match. */
  readonly toolset: ToolsetInfo;
  /** The MCP client's name and version as reported (sanitised by the hub). */
  readonly clientInfo: () => ClientInfo | null;
  /** The workspace folder's base name, shown in the grants dialog. */
  readonly cwdName: string;
  /** Tool definitions by name (the server's own: output schemas, budgets, `kind`). */
  readonly tools: ReadonlyMap<string, AgentToolDef>;
  readonly files?: TabFileHooks;
  /** Overrides for tests. */
  readonly timing?: {
    readonly helloTimeoutMs?: number;
    readonly pingIntervalMs?: number;
    readonly callMs?: number;
    readonly connectMs?: number;
    readonly confirmExtensionMs?: number;
  };
}

export interface BridgeServer extends TabLink {
  /** Sockets that are open but not paired (tests). */
  unpairedSockets(): number;
}

interface Sock {
  readonly ws: WebSocket;
  readonly origin: string;
  hello: boolean;
  helloTimer: ReturnType<typeof setTimeout> | null;
  code: string | null;
  missedPongs: number;
  /** The header of the binary frame that must come next. */
  expect: Extract<BridgeMessage, { t: 'blob' }> | null;
  /** Blobs being received (id → chunks). */
  blobs: Map<
    string,
    { chunks: Buffer[]; bytes: number; nextSeq: number; done: boolean; hash: ReturnType<typeof createHash> }
  >;
  blobBytes: number;
  toolset: string;
}

type ClaimAnswer = { readonly kind: 'accept'; readonly pairing: Pairing } | { readonly kind: 'deny' | 'closed' };
interface Pending {
  readonly code: string;
  readonly sock: Sock;
  readonly expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  claim: { readonly answer: Promise<ClaimAnswer>; resolve: (answer: ClaimAnswer) => void } | null;
}

interface Call {
  readonly id: string;
  readonly tool: AgentToolDef;
  readonly args: unknown;
  readonly resolve: (result: AgentToolResult<unknown>) => void;
  readonly progress: TabCallOptions['progress'];
  timer: ReturnType<typeof setTimeout>;
  extended: boolean;
}

interface Pairing {
  readonly sock: Sock;
  readonly session: string;
  readonly token: string;
  readonly actor: RunActor;
  readonly handle: string;
  readonly pairedAt: number;
  grants: Grants;
  paused: boolean;
  title: string;
  project: string;
  reported: boolean;
  onReport: (() => void) | null;
  readonly calls: Map<string, Call>;
}

const fail = (
  code:
    | 'not_connected'
    | 'busy'
    | 'not_found'
    | 'declined'
    | 'timeout'
    | 'cancelled'
    | 'unsupported'
    | 'not_granted'
    | 'internal',
  message: string,
  hint: string,
  retryable: boolean,
): AgentToolResult<unknown> => ({ ok: false, error: { code, message, hint, retryable } });

const NOT_CONNECTED = (): AgentToolResult<unknown> =>
  fail(
    'not_connected',
    'The editor tab is no longer paired.',
    'ask the user for a new code (Windows › Agent) and call editor_connect',
    true,
  );

/** Listens on `port` (127.0.0.1); rejects with the listen error (EADDRINUSE …). */
function listen(server: HttpServer, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ port, host: '127.0.0.1', exclusive: true });
  });
}

const major = (version: string): string => version.split('.')[0] ?? version;
const name = (text: string, max = 120): string => sanitizeText(text, { maxChars: max, kind: 'name' });

/**
 * Starts the bridge. Resolves null (and logs) when no default port is free; a fixed port that is taken rejects.
 */
export async function startBridgeServer(opts: BridgeServerOptions): Promise<BridgeServer | null> {
  const { config, log } = opts;
  const helloTimeoutMs = opts.timing?.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const pingIntervalMs = opts.timing?.pingIntervalMs ?? PING_INTERVAL_MS;
  const callMs = opts.timing?.callMs ?? BRIDGE_DEADLINES.callMs;
  const connectMs = opts.timing?.connectMs ?? BRIDGE_DEADLINES.connectMs;
  const confirmExtensionMs = opts.timing?.confirmExtensionMs ?? 50_000;
  const startedAt = Date.now();
  // The hosted editor is one of the editor's own origins (§5.10, M4a): compiled in next to the configured list.
  const allowedOrigins = config.allowedOrigins.includes(HOSTED_EDITOR_ORIGIN)
    ? config.allowedOrigins
    : [...config.allowedOrigins, HOSTED_EDITOR_ORIGIN];

  const http = createServer((_req, res) => {
    res.writeHead(426, { 'content-type': 'text/plain' }).end('ekza-studio-mcp bridge: WebSocket only\n');
  });
  let port: number | null = null;
  if (config.port !== null) {
    port = await listen(http, config.port);
  } else {
    for (let p = BRIDGE_PORTS.first; p <= BRIDGE_PORTS.last && port === null; p++) {
      try {
        port = await listen(http, p);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      }
    }
    if (port === null) {
      log.warn(`bridge off: ports ${BRIDGE_PORTS.first}–${BRIDGE_PORTS.last} are all taken`);
      return null;
    }
  }
  const boundPort = port;
  const wss = new WebSocketServer({ noServer: true, maxPayload: BRIDGE_LIMITS.maxPayloadBytes });
  const refused = refusalLogger((line) => log.warn(line));
  const sockets = new Set<Sock>();
  const pending = new Map<string, Pending>();
  let pairing: Pairing | null = null;
  let wrongAt: number[] = [];
  let lockedUntil = 0;
  let callCounter = 0;
  let closed = false;

  const send = (sock: Sock, message: BridgeMessage): void => {
    if (sock.ws.readyState === sock.ws.OPEN) sock.ws.send(serializeBridgeMessage(message));
  };
  const sendError = (sock: Sock, code: string, message: string): void => send(sock, { t: 'error', code, message });
  const unpairedCount = (): number => [...sockets].filter((s) => pairing?.sock !== s).length;

  const dropCode = (sock: Sock, answer: ClaimAnswer['kind'] = 'closed'): void => {
    if (sock.code === null) return;
    const entry = pending.get(sock.code);
    sock.code = null;
    if (entry === undefined) return;
    pending.delete(entry.code);
    clearTimeout(entry.timer);
    if (answer !== 'accept') entry.claim?.resolve({ kind: answer });
  };

  const endPairing = (reason: string): void => {
    const current = pairing;
    if (current === null) return;
    pairing = null;
    for (const call of current.calls.values()) {
      clearTimeout(call.timer);
      call.resolve(NOT_CONNECTED());
    }
    current.calls.clear();
    current.onReport?.();
    log.info(`pairing ended (${reason})`);
  };

  const closeSock = (sock: Sock, code: number, reason: string): void => {
    try {
      sock.ws.close(code, reason.slice(0, 120));
    } catch {
      sock.ws.terminate();
    }
  };

  const onClose = (sock: Sock): void => {
    if (!sockets.delete(sock)) return;
    if (sock.helloTimer !== null) clearTimeout(sock.helloTimer);
    dropCode(sock);
    if (pairing?.sock === sock) endPairing('socket closed');
  };

  // ---------- upgrades ----------
  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const reject = (status: number, text: string): void => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    if (closed) return reject(503, 'Service Unavailable');
    const origin = req.headers.origin;
    const verdict = checkUpgrade({ host: req.headers.host, origin }, boundPort, allowedOrigins);
    if (verdict !== null) {
      refused(
        verdict.reason,
        verdict.reason === 'host'
          ? `Host ${String(req.headers.host).slice(0, 80)}`
          : `Origin ${String(origin).slice(0, 80)}`,
      );
      return reject(403, 'Forbidden');
    }
    if (unpairedCount() >= config.maxUnpairedSockets) {
      refused('full', `more than ${config.maxUnpairedSockets} unpaired sockets`);
      return reject(503, 'Service Unavailable');
    }
    wss.handleUpgrade(req, socket, head, (ws) => accept(ws, origin as string));
  });

  const accept = (ws: WebSocket, origin: string): void => {
    const sock: Sock = {
      ws,
      origin: origin.toLowerCase(),
      hello: false,
      helloTimer: null,
      code: null,
      missedPongs: 0,
      expect: null,
      blobs: new Map(),
      blobBytes: 0,
      toolset: '',
    };
    sockets.add(sock);
    sock.helloTimer = setTimeout(() => {
      sock.helloTimer = null;
      if (!sock.hello) closeSock(sock, BRIDGE_CLOSE.invalidMessage, 'no hello');
    }, helloTimeoutMs);
    ws.on('pong', () => {
      sock.missedPongs = 0;
    });
    ws.on('close', () => onClose(sock));
    ws.on('error', () => onClose(sock));
    ws.on('message', (data: RawData, isBinary: boolean) => {
      try {
        onFrame(sock, data, isBinary);
      } catch (error) {
        log.debug(`bridge frame: ${error instanceof Error ? error.message : String(error)}`);
        closeSock(sock, BRIDGE_CLOSE.invalidMessage, 'invalid message');
      }
    });
  };

  const frameBytes = (data: RawData): Buffer =>
    Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);

  // ---------- frames ----------
  const onFrame = (sock: Sock, data: RawData, isBinary: boolean): void => {
    const bytes = frameBytes(data);
    const paired = pairing?.sock === sock;
    if (!paired && bytes.length > BRIDGE_LIMITS.unpairedFrameBytes) {
      closeSock(sock, BRIDGE_CLOSE.tooBig, 'frame too big before pairing');
      return;
    }
    if (isBinary) {
      onBinary(sock, bytes);
      return;
    }
    if (sock.expect !== null) {
      closeSock(sock, BRIDGE_CLOSE.invalidMessage, 'binary frame expected');
      return;
    }
    let message: BridgeMessage;
    try {
      message = parseBridgeMessage(bytes.toString('utf8'));
    } catch (error) {
      log.debug(`bridge: ${error instanceof Error ? error.message : String(error)}`);
      closeSock(sock, BRIDGE_CLOSE.invalidMessage, 'invalid message');
      return;
    }
    if (!sock.hello) {
      if (message.t !== 'hello') {
        closeSock(sock, BRIDGE_CLOSE.invalidMessage, 'hello first');
        return;
      }
      onHello(sock, message);
      return;
    }
    if (paired) onPairedMessage(sock, pairing as Pairing, message);
    else onUnpairedMessage(sock, message);
  };

  const onBinary = (sock: Sock, bytes: Buffer): void => {
    const header = sock.expect;
    if (header === null || pairing?.sock !== sock || bytes.length !== header.bytes) {
      closeSock(sock, BRIDGE_CLOSE.invalidMessage, 'unexpected binary frame');
      return;
    }
    sock.expect = null;
    let blob = sock.blobs.get(header.id);
    if (blob === undefined) {
      blob = { chunks: [], bytes: 0, nextSeq: 0, done: false, hash: createHash('sha256') };
      sock.blobs.set(header.id, blob);
    }
    if (blob.done || header.seq !== blob.nextSeq) {
      closeSock(sock, BRIDGE_CLOSE.invalidMessage, 'blob out of order');
      return;
    }
    sock.blobBytes += bytes.length;
    if (sock.blobBytes > BRIDGE_LIMITS.maxCallBytes) {
      closeSock(sock, BRIDGE_CLOSE.tooBig, 'blobs too large');
      return;
    }
    blob.chunks.push(bytes);
    blob.bytes += bytes.length;
    blob.nextSeq += 1;
    blob.hash.update(bytes);
    if (header.last) {
      blob.done = true;
      if (header.sha256 !== undefined && blob.hash.digest('hex') !== header.sha256) {
        closeSock(sock, BRIDGE_CLOSE.invalidMessage, 'blob checksum');
      }
    }
  };

  /** Takes a complete blob out of the socket's store. */
  const takeBlob = (sock: Sock, id: string): Uint8Array | null => {
    const blob = sock.blobs.get(id);
    if (blob === undefined || !blob.done) return null;
    sock.blobs.delete(id);
    sock.blobBytes -= blob.bytes;
    const out = Buffer.concat(blob.chunks);
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  };

  const onHello = (sock: Sock, message: Extract<BridgeMessage, { t: 'hello' }>): void => {
    if (sock.helloTimer !== null) {
      clearTimeout(sock.helloTimer);
      sock.helloTimer = null;
    }
    if (major(message.toolset.version) !== major(opts.toolset.version)) {
      send(sock, {
        t: 'hello.refused',
        code: 'version_mismatch',
        message: `This editor (toolset ${major(message.toolset.version)}.x) and the agent server (${major(opts.toolset.version)}.x) do not match: reload the editor, or update the version pinned in your agent's MCP configuration (docs/agents.md).`,
      });
      closeSock(sock, 1000, 'version');
      return;
    }
    if (message.toolset.hash !== opts.toolset.hash) {
      log.debug(`bridge: the editor's toolset ${message.toolset.version} differs from the server's (same major)`);
    }
    sock.hello = true;
    sock.toolset = message.toolset.version;
    send(sock, {
      t: 'hello.ok',
      server: { name: 'ekza-studio-mcp', version: SERVER_VERSION, startedAt },
      client: clientInfo(),
      toolset: opts.toolset,
      busy: pairing !== null,
    });
  };

  const clientInfo = (): ClientInfo | null => {
    const info = opts.clientInfo();
    return info === null ? null : { name: name(info.name, 200), version: name(info.version, 64) };
  };

  const onUnpairedMessage = (sock: Sock, message: BridgeMessage): void => {
    switch (message.t) {
      case 'pair.offer': {
        if (pairing !== null) {
          sendError(sock, 'busy', 'This agent server is connected to another tab.');
          return;
        }
        dropCode(sock);
        if (pending.size >= MAX_PENDING_CODES) {
          sendError(sock, 'busy', 'Too many tabs are offering codes; try again in a minute.');
          return;
        }
        const code = generatePairingCode((c) => pending.has(c));
        const expiresAt = Date.now() + config.pairingTtlMs;
        const entry: Pending = {
          code,
          sock,
          expiresAt,
          claim: null,
          timer: setTimeout(() => {
            if (sock.code === code) dropCode(sock, 'deny');
          }, config.pairingTtlMs),
        };
        pending.set(code, entry);
        sock.code = code;
        send(sock, { t: 'pair.code', code: displayPairingCode(code), expiresAt });
        return;
      }
      case 'pair.accept':
      case 'pair.deny': {
        const entry = sock.code === null ? undefined : pending.get(sock.code);
        if (entry?.claim === null || entry?.claim === undefined) {
          sendError(sock, 'not_claimed', 'No agent has claimed this code yet.');
          return;
        }
        const claim = entry.claim;
        if (message.t === 'pair.deny' || pairing !== null) {
          dropCode(sock, 'deny');
          return;
        }
        // Accept: the pairing starts now.
        dropCode(sock, 'accept');
        const info = clientInfo();
        const actorName = name(info?.name ?? 'Agent', 40) || 'Agent';
        const current: Pairing = {
          sock,
          session: `ses_${randomBase62(12)}`,
          token: newSessionToken(),
          actor: { kind: 'agent', id: `agt_${randomBase62(12)}`, name: actorName },
          handle: `tab_${randomBase62(12)}`,
          pairedAt: Date.now(),
          grants: message.grants,
          paused: false,
          title: '',
          project: '',
          reported: false,
          onReport: null,
          calls: new Map(),
        };
        pairing = current;
        send(sock, { t: 'pair.ok', session: current.session, token: current.token, actor: current.actor });
        log.info(`paired with a tab at ${sock.origin}`);
        claim.resolve({ kind: 'accept', pairing: current });
        return;
      }
      case 'bye':
        closeSock(sock, 1000, 'bye');
        return;
      case 'error':
        return;
      case 'resume':
        sendError(sock, 'unsupported', 'Resume is not available in this build: pair again.');
        return;
      case 'hello':
      case 'hello.ok':
      case 'hello.refused':
      case 'pair.code':
      case 'pair.claimed':
      case 'pair.ok':
      case 'tab':
      case 'resume.ok':
      case 'call':
      case 'progress':
      case 'result':
      case 'cancel':
      case 'grants':
      case 'paused':
      case 'blob':
        sendError(sock, 'not_paired', 'Pair first.');
    }
  };

  const onPairedMessage = (sock: Sock, current: Pairing, message: BridgeMessage): void => {
    switch (message.t) {
      case 'tab':
        current.title = name(message.title, 200);
        current.project = name(message.project, 200);
        current.reported = true;
        current.onReport?.();
        return;
      case 'grants':
        current.grants = message.grants;
        return;
      case 'paused':
        current.paused = message.on;
        return;
      case 'progress': {
        const call = current.calls.get(message.id);
        if (call === undefined) return;
        const text =
          message.message === undefined ? undefined : sanitizeText(message.message, { maxChars: 120, kind: 'prose' });
        if (!call.extended && (text === WAITING_FOR_CONFIRM || text === WAITING_FOR_REDO)) {
          // §5.8 7: a card that opens extends the deadline once by the confirmation timeout.
          call.extended = true;
          clearTimeout(call.timer);
          call.timer = setTimeout(() => timeoutCall(current, call), callMs + confirmExtensionMs);
        }
        call.progress?.(message.done, message.total, text);
        return;
      }
      case 'blob':
        if (sock.expect !== null) {
          closeSock(sock, BRIDGE_CLOSE.invalidMessage, 'binary frame expected');
          return;
        }
        sock.expect = message;
        return;
      case 'result':
        void onResult(sock, current, message);
        return;
      case 'bye':
        endPairing(`the tab said bye (${message.reason})`);
        closeSock(sock, 1000, 'bye');
        return;
      case 'error':
        log.debug(`bridge: tab error ${message.code}`);
        return;
      case 'hello':
      case 'hello.ok':
      case 'hello.refused':
      case 'pair.offer':
      case 'pair.code':
      case 'pair.claimed':
      case 'pair.accept':
      case 'pair.deny':
      case 'pair.ok':
      case 'resume':
      case 'resume.ok':
      case 'call':
      case 'cancel':
        sendError(sock, 'unexpected', `Unexpected ${message.t} while paired.`);
    }
  };

  const onResult = async (
    sock: Sock,
    current: Pairing,
    message: Extract<BridgeMessage, { t: 'result' }>,
  ): Promise<void> => {
    const call = current.calls.get(message.id);
    // Blobs of a result belong to it whether or not the call still waits.
    const images: AgentImage[] = [];
    let missing = false;
    for (const image of message.images) {
      const bytes = takeBlob(sock, image.blob);
      if (bytes === null) missing = true;
      else images.push({ bytes, mime: image.mime, width: image.width, height: image.height });
    }
    const writes: { name: string; bytes: Uint8Array }[] = [];
    for (const write of message.writes) {
      const bytes = takeBlob(sock, write.blob);
      if (bytes === null) missing = true;
      else writes.push({ name: write.name, bytes });
    }
    if (call === undefined) return; // timed out, cancelled or unknown: nothing waits
    current.calls.delete(call.id);
    clearTimeout(call.timer);
    if (missing) {
      call.resolve(revalidateTabResult(call.tool, null));
      return;
    }
    let result = revalidateTabResult(call.tool, message.result, images);
    if (result.ok && writes.length > 0) {
      const outcome =
        opts.files === undefined
          ? fail(
              'unsupported',
              'Workspace writes are not available in this build.',
              'deliver the file as a download',
              false,
            )
          : !(current.grants.files && current.grants.workspace)
            ? fail(
                'not_granted',
                'Writing into the workspace folder needs the Workspace option of the Files grant.',
                'only the user can give it, in the Agent panel; or deliver the file as a download',
                false,
              )
            : await opts.files
                .write(call.tool, call.args, writes)
                .catch(() => fail('internal', 'The workspace write failed.', 'call the tool again', false));
      if (outcome !== null) result = outcome;
    }
    call.resolve(result);
  };

  const timeoutCall = (current: Pairing, call: Call): void => {
    if (!current.calls.delete(call.id)) return;
    send(current.sock, { t: 'cancel', id: call.id });
    call.resolve(
      fail(
        'timeout',
        `${call.tool.name} did not finish in time.`,
        'check the result with a read (an edit may already be applied) before calling it again',
        false,
      ),
    );
  };

  // ---------- keep-alive ----------
  const ping = setInterval(() => {
    for (const sock of sockets) {
      if (sock.missedPongs >= 2) {
        sock.ws.terminate();
        continue;
      }
      sock.missedPongs += 1;
      try {
        sock.ws.ping();
      } catch {
        // closing
      }
    }
  }, pingIntervalMs);
  ping.unref();

  // ---------- the link ----------
  const recordWrong = (): void => {
    const now = Date.now();
    wrongAt = wrongAt.filter((t) => now - t < WRONG_CODES_WINDOW_MS);
    wrongAt.push(now);
    if (wrongAt.length >= WRONG_CODES_MAX) {
      lockedUntil = now + config.pairingLockoutMs;
      wrongAt = [];
      log.warn('bridge: five wrong pairing codes; pairing locked for a minute');
    }
  };

  const findPending = (code: string): Pending | null => {
    let found: Pending | null = null;
    for (const entry of pending.values()) if (secretsEqual(entry.code, code)) found = entry;
    return found !== null && found.expiresAt > Date.now() ? found : null;
  };

  const waitFor = <T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T | 'timeout' | 'cancelled'> =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve('cancelled');
      const timer = setTimeout(() => finish('timeout'), ms);
      const onAbort = (): void => finish('cancelled');
      const finish = (value: T | 'timeout' | 'cancelled'): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(finish, () => finish('cancelled'));
    });

  const tabInfo = (current: Pairing): TabInfo => ({
    handle: current.handle,
    origin: current.sock.origin,
    title: current.title,
    project: current.project,
    grants: current.grants,
    paused: current.paused,
    toolset: current.sock.toolset,
    pairedAt: current.pairedAt,
  });

  const relay = (
    current: Pairing,
    tool: AgentToolDef,
    args: unknown,
    callOpts: TabCallOptions,
  ): Promise<AgentToolResult<unknown>> =>
    new Promise((resolve) => {
      if (callOpts.signal.aborted) {
        resolve(fail('cancelled', 'The call was cancelled.', 'nothing changed', true));
        return;
      }
      const id = `c_${++callCounter}${randomBase62(8)}`;
      const ms = tool.kind === 'files' ? BRIDGE_DEADLINES.filesMs : tool.name === 'editor_connect' ? connectMs : callMs;
      const onAbort = (): void => {
        if (!current.calls.delete(id)) return;
        clearTimeout(call.timer);
        send(current.sock, { t: 'cancel', id });
        resolve(fail('cancelled', 'The call was cancelled.', 'check with a read whether an edit applied', true));
      };
      const call: Call = {
        id,
        tool,
        args,
        progress: callOpts.progress,
        extended: false,
        resolve: (result) => {
          callOpts.signal.removeEventListener('abort', onAbort);
          resolve(result);
        },
        timer: setTimeout(() => timeoutCall(current, call), ms),
      };
      current.calls.set(id, call);
      callOpts.signal.addEventListener('abort', onAbort, { once: true });
      void (async () => {
        // workspace bytes go to the tab only while the user granted Files with the workspace folder (§5.9, INT)
        const hooks = current.grants.files && current.grants.workspace ? opts.files : undefined;
        const files = hooks === undefined ? [] : await hooks.attach(tool, args).catch(() => []);
        if (!current.calls.has(id)) return;
        const attached: { path: string; blob: string }[] = [];
        for (const [index, file] of files.entries()) {
          const blob = `${id}_f${index}`;
          sendBlob(current.sock, blob, file.bytes);
          attached.push({ path: file.path, blob });
        }
        send(current.sock, {
          t: 'call',
          id,
          tool: tool.name,
          args,
          progress: callOpts.progress !== undefined,
          deadline: Date.now() + ms,
          files: attached,
        });
      })();
    });

  const sendBlob = (sock: Sock, id: string, bytes: Uint8Array): void => {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const chunk = BRIDGE_LIMITS.blobChunkBytes;
    const count = Math.max(1, Math.ceil(bytes.length / chunk));
    for (let seq = 0; seq < count; seq++) {
      const part = bytes.subarray(seq * chunk, (seq + 1) * chunk);
      const last = seq === count - 1;
      send(sock, { t: 'blob', id, seq, last, bytes: part.length, ...(last ? { sha256 } : {}) });
      if (sock.ws.readyState === sock.ws.OPEN) sock.ws.send(part, { binary: true });
    }
  };

  const link: BridgeServer = {
    port: boundPort,
    status: () => (pairing === null ? 'listening' : 'paired'),
    tab: () => (pairing === null ? null : tabInfo(pairing)),
    unpairedSockets: unpairedCount,

    async claim(codeText, callOpts) {
      const connectTool = opts.tools.get('editor_connect');
      if (Date.now() < lockedUntil) {
        return fail(
          'busy',
          'Too many wrong codes; wait a minute.',
          'wait a minute, then ask the user for the code again',
          true,
        );
      }
      const code = normalizePairingCode(codeText);
      const entry = code === null ? null : findPending(code);
      if (entry === null) {
        recordWrong();
        return fail(
          'not_found',
          'No editor is offering this code.',
          'check the code in Windows › Agent and ask the user for it again',
          true,
        );
      }
      if (pairing !== null) {
        return fail(
          'busy',
          'This agent server is already connected to an editor tab.',
          'use the paired tab (projects_list)',
          true,
        );
      }
      if (entry.claim === null) {
        let resolveClaim: (answer: ClaimAnswer) => void = () => {};
        const answer = new Promise<ClaimAnswer>((resolve) => {
          resolveClaim = resolve;
        });
        entry.claim = { answer, resolve: resolveClaim };
        send(entry.sock, { t: 'pair.claimed', client: clientInfo(), cwdName: name(opts.cwdName, 200) });
      }
      const answer = await waitFor(entry.claim.answer, connectMs, callOpts.signal);
      if (answer === 'cancelled') return fail('cancelled', 'The call was cancelled.', 'nothing changed', true);
      if (answer === 'timeout') {
        return fail('busy', 'The user has not answered yet.', 'call editor_connect again with the same code', true);
      }
      if (answer.kind === 'deny') {
        return fail('declined', 'The user declined the connection.', 'do not retry without asking the user', false);
      }
      if (answer.kind !== 'accept') return NOT_CONNECTED();
      const current = answer.pairing;
      if (!current.reported) {
        await waitFor(
          new Promise<void>((resolve) => {
            current.onReport = resolve;
          }),
          TAB_REPORT_WAIT_MS,
          callOpts.signal,
        );
        current.onReport = null;
      }
      if (link.tab()?.handle !== current.handle) return NOT_CONNECTED();
      const summaryTool = opts.tools.get('scene_summary');
      let summary: unknown = null;
      if (summaryTool !== undefined) {
        const read = await relay(current, summaryTool, {}, { signal: callOpts.signal });
        if (!read.ok) return read;
        summary = read.data;
      }
      const data = {
        project: current.handle,
        grants: current.grants,
        actor: { name: current.actor.name },
        origin: current.sock.origin,
        summary,
      };
      return finishResult(
        {
          ok: true,
          data,
          next: 'call scene_summary or rig_describe; pass project only when several projects are open',
        },
        connectTool === undefined
          ? null
          : { maxTokens: connectTool.budget.maxTokens, schema: outputJsonSchemaOf(connectTool.output) },
      );
    },

    call(tool, args, callOpts) {
      if (pairing === null) return Promise.resolve(NOT_CONNECTED());
      return relay(pairing, tool, args, callOpts);
    },

    unpair(handle) {
      const current = pairing;
      if (current === null || current.handle !== handle) return false;
      send(current.sock, { t: 'bye', reason: 'server' });
      endPairing('project_close');
      closeSock(current.sock, 1000, 'bye');
      return true;
    },

    async close() {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      if (pairing !== null) send(pairing.sock, { t: 'bye', reason: 'server' });
      endPairing('server stopping');
      for (const sock of Array.from(sockets)) {
        dropCode(sock);
        closeSock(sock, 1001, 'server stopping');
      }
      for (const sock of Array.from(sockets)) sock.ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
  log.info(`bridge listening on 127.0.0.1:${boundPort} (protocol ${BRIDGE_PROTOCOL})`);
  return link;
}
