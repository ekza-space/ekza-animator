// Startup check of the generation gateway (server builds only; `.gen.ts` is a server-build page extension and Next
// resolves the instrumentation file through the page extensions). A refused configuration — provider keys without
// GEN_GATEWAY_TOKEN, a weak token, missing spend caps — throws here, so `next start` does not serve (ADR 0017 §2).
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const { assertGatewayStartup } = await import('@ekza-studio/gen-gateway/next');
  assertGatewayStartup(process.env);
}
