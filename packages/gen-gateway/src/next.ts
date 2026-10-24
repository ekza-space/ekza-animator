// The Next.js mount (server builds only): `apps/web/app/api/gen/[...path]/route.gen.ts` re-exports these handlers.
// The configuration is read once, on the first request or at server start (`assertGatewayStartup` from the app's
// instrumentation hook): a refused configuration stops `next start` (ADR 0017 §2). Disabled, every path is a 404.
import { defaultAdapters, providerEnvs } from './adapters/index.ts';
import { type ConfigResult, type Env, loadGatewayConfig } from './config.ts';
import { createGateway, type Gateway } from './handler.ts';

export const NEXT_BASE_PATH = '/api/gen';

/** Throws `GatewayConfigError` when the gateway may not start (keys without auth, missing caps, weak token). */
export function assertGatewayStartup(env: Env): ConfigResult {
  return loadGatewayConfig(env, 'next', providerEnvs(defaultAdapters()));
}

export interface NextRouteHandlers {
  GET(req: Request): Promise<Response>;
  POST(req: Request): Promise<Response>;
  DELETE(req: Request): Promise<Response>;
  OPTIONS(req: Request): Promise<Response>;
}

export function createNextRouteHandlers(env: Env, basePath = NEXT_BASE_PATH): NextRouteHandlers {
  let ready: Promise<Gateway> | null = null;
  const gateway = (): Promise<Gateway> => {
    ready ??= (async () => {
      const adapters = defaultAdapters();
      const config = loadGatewayConfig(env, 'next', providerEnvs(adapters));
      let stores = {};
      if (config.enabled && config.dataDir !== null) {
        const { openFileStores } = await import('./node/fsStores.ts');
        stores = await openFileStores(config.dataDir);
      }
      const gw = createGateway({ config, adapters, basePath, ...stores });
      await gw.start();
      return gw;
    })();
    return ready;
  };
  const handle = async (req: Request): Promise<Response> => (await gateway()).handle(req);
  return { GET: handle, POST: handle, DELETE: handle, OPTIONS: handle };
}
