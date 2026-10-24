// Startup check of the generation gateway (server builds only; `.gen.ts` is a server-build page extension and Next
// resolves the instrumentation file through the page extensions). A refused configuration — provider keys without
// GEN_GATEWAY_TOKEN, a weak token, missing spend caps — stops the process with exit code 78 (EX_CONFIG), like the
// standalone gateway: Next alone would keep the port open and answer 500 to every request (ADR 0017 §2).
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const { assertGatewayStartup } = await import('@ekza-studio/gen-gateway/next');
  try {
    assertGatewayStartup(process.env);
  } catch (err) {
    console.error(`gen-gateway: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(78);
  }
}
