// The generation gateway (`ekza-gen/v1`, ADR 0017) mounted in server builds only: the `.gen.ts` extension is a page
// extension of server builds (`next.config.ts`), so a static export neither routes to nor bundles this file. Without
// GEN_GATEWAY_ENABLED=1 every path answers 404; enabled, it needs GEN_GATEWAY_TOKEN and the spend caps
// (docs/wp-notes/m7-gbc.md). The browser reaches it through GenerationClient (@ekza-studio/gen-core) only.
import { createNextRouteHandlers } from '@ekza-studio/gen-gateway/next';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers = createNextRouteHandlers(process.env);

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
export const OPTIONS = handlers.OPTIONS;
