#!/usr/bin/env node
// `node packages/gen-gateway/src/node/main.ts` (Node ≥ 24 runs the TypeScript directly): the standalone gateway with
// its configuration from the environment (see deploy/gen-gateway.env.example). Exits 78 (EX_CONFIG) when the
// configuration is refused — for example provider keys without an auth.
import { GatewayConfigError } from '../config.ts';
import { startStandaloneGateway } from './server.ts';

try {
  const gw = await startStandaloneGateway({ env: process.env });
  console.error(JSON.stringify({ t: new Date().toISOString(), level: 'info', msg: 'gateway.listening', url: gw.url }));
  const stop = (): void => {
    void gw.close().then(() => process.exit(0));
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch (err) {
  if (err instanceof GatewayConfigError) {
    console.error(`gen-gateway: ${err.message}`);
    process.exit(78);
  }
  throw err;
}
