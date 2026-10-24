// The standalone gateway: a Node HTTP server around the Fetch handler, for the dev VPS (behind Caddy) or later the
// Hub. Loopback mode needs the socket's peer address, which only this server can see.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { defaultAdapters, providerEnvs } from '../adapters/index.ts';
import type { ProviderAdapter } from '../adapters/types.ts';
import { type Env, GatewayConfigError, loadGatewayConfig } from '../config.ts';
import { createGateway, type Gateway } from '../handler.ts';
import type { Logger } from '../logger.ts';
import { openFileStores } from './fsStores.ts';

export interface StandaloneOptions {
  readonly env: Env;
  readonly adapters?: readonly ProviderAdapter[];
  readonly log?: Logger;
  readonly fetch?: typeof fetch;
  readonly timeScale?: number;
  /** Overrides GEN_GATEWAY_PORT (0 = any free port, for tests). */
  readonly port?: number;
}

export interface StandaloneGateway {
  readonly url: string;
  readonly server: Server;
  readonly gateway: Gateway;
  close(): Promise<void>;
}

function toRequest(req: IncomingMessage, signal: AbortSignal): Request {
  const headers = new Headers();
  const raw = req.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) headers.append(raw[i] ?? '', raw[i + 1] ?? '');
  const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  // `duplex: 'half'` streams the request body (Node's fetch requires it for a stream body).
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    signal,
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' as const } : {}),
  };
  return new Request(url, init);
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (response.body === null) {
    res.end();
    return;
  }
  res.flushHeaders();
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise<void>((r) => res.once('drain', () => r()));
    }
  } finally {
    res.end();
  }
}

export async function startStandaloneGateway(opts: StandaloneOptions): Promise<StandaloneGateway> {
  const adapters = opts.adapters ?? defaultAdapters();
  const config = loadGatewayConfig(opts.env, 'standalone', providerEnvs(adapters));
  if (!config.enabled) throw new GatewayConfigError('Set GEN_GATEWAY_ENABLED=1 to run the gateway.');
  const stores = config.dataDir === null ? null : await openFileStores(config.dataDir);
  const gateway = createGateway({
    config,
    adapters,
    ...stores,
    ...(opts.log ? { log: opts.log } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.timeScale === undefined ? {} : { timeScale: opts.timeScale }),
    basePath: (opts.env['GEN_BASE_PATH'] ?? '').trim(),
  });
  await gateway.start();
  const server = createServer((req, res) => {
    const ctrl = new AbortController();
    res.on('close', () => ctrl.abort());
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('ok');
      return;
    }
    void gateway
      .handle(toRequest(req, ctrl.signal), { remoteAddress: req.socket.remoteAddress ?? null })
      .then((response) => writeResponse(res, response))
      .catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
        else res.end();
      });
  });
  // Loopback mode binds only to the loopback address it was given.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? config.port, config.host, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  const host = addr.family === 'IPv6' ? `[${addr.address}]` : addr.address;
  return {
    url: `http://${host}:${addr.port}`,
    server,
    gateway,
    async close() {
      await gateway.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
