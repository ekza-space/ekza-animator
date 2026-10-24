// @ekza-studio/gen-gateway (ADR 0017 §2): the server side of AI 3D generation — the `ekza-gen/v1` Fetch handler,
// default-deny configuration, job engine, provider adapters (Tripo, Meshy), stores and the redacting logger.
// Server only: it must never enter a browser bundle (the client-bundle check looks for GATEWAY_MARKER, the key
// variable names and the provider origins). The browser uses `GenerationClient` from @ekza-studio/gen-core.
export * from './adapters/index.ts';
export * from './config.ts';
export { Engine, type EngineDeps, usdOf } from './engine.ts';
export { createEgress, hostAllowed } from './egress.ts';
export {
  createGateway,
  GATEWAY_MARKER,
  type Gateway,
  type GatewayOptions,
  type RequestInfo,
  secretEquals,
} from './handler.ts';
export { ApiError } from './http.ts';
export { checkGlb, checkImage, InputError, sniff } from './inputs.ts';
export * from './logger.ts';
export * from './stores.ts';
