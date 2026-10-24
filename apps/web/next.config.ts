import type { NextConfig } from 'next';
import { buildCsp, GATEWAY_URL_ENV, gatewayOrigin } from './csp';

/** `PHASE_DEVELOPMENT_SERVER` of `next/constants` (config files may import only `next` itself). */
const PHASE_DEVELOPMENT_SERVER = 'phase-development-server';

/** Reads a `STUDIO_*` switch, also accepting its pre-rename `ANIMATOR_*` name (Ekza Animator → Ekza Studio). */
const envFlag = (name: string): boolean =>
  process.env[`STUDIO_${name}`] === '1' || process.env[`ANIMATOR_${name}`] === '1';

/** `STUDIO_STATIC_EXPORT=1` builds a static, server-less editor (GitHub Pages, IPFS, intranet). */
const staticExport = envFlag('STATIC_EXPORT');
/**
 * `STUDIO_SOURCE_MAPS=1` writes browser source maps next to the client chunks: `pnpm --filter web size:attribute`
 * reads them for the chunk attribution report (M2A-SPEC §5.21.2). Never set for a deployed build.
 */
const browserSourceMaps = envFlag('SOURCE_MAPS');

const PAGE_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js'];
/**
 * Dev/e2e-only routes (`app/dev/**`) are `page.dev.tsx` files: Next treats them as pages only under `next dev` or
 * in a build with NEXT_PUBLIC_EKZA_E2E=1, so normal builds and static exports neither route to nor bundle the test kit.
 */
const DEV_PAGE_EXTENSIONS = [...PAGE_EXTENSIONS, 'dev.tsx'];
/**
 * M7 G-b (ADR 0017 §2): the generation gateway's route (`app/api/gen/[...path]/route.gen.ts`) and its startup check
 * (`instrumentation.gen.ts`) exist only in server builds; a static export has no server and never bundles them. The
 * route itself answers 404 unless GEN_GATEWAY_ENABLED=1 (default deny).
 */
const SERVER_EXTENSIONS = ['gen.ts'];
/** The gateway URL fixed at build time (static exports connect only to it); its origin enters the CSP. */
const gatewayUrl = (process.env[GATEWAY_URL_ENV] ?? '').trim();

export default function nextConfig(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  const devRoutes = dev || process.env.NEXT_PUBLIC_EKZA_E2E === '1';
  const pageExtensions = [
    ...(devRoutes ? DEV_PAGE_EXTENSIONS : PAGE_EXTENSIONS),
    ...(staticExport ? [] : SERVER_EXTENSIONS),
  ];
  // Throws on a non-https gateway URL: the build stops instead of shipping a policy that allows it.
  const csp = buildCsp({ dev, gatewayOrigin: gatewayOrigin(gatewayUrl), header: true });
  return {
    ...(staticExport ? { output: 'export' } : {}),
    pageExtensions,
    // The generation client's base: the build-time URL, else the server build's own route; '' = no gateway (static).
    env: { NEXT_PUBLIC_EKZA_GEN_GATEWAY: gatewayUrl !== '' ? gatewayUrl : staticExport ? '' : '/api/gen' },
    // M7 G-b: the app's Content-Security-Policy on every response of a server build (static exports: a meta tag).
    ...(staticExport
      ? {}
      : {
          async headers() {
            return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: csp }] }];
          },
        }),
    reactStrictMode: true,
    // M-2 (M2A-SPEC §5.21.2): one large chunk per chunk group instead of many. gzip restarts at every file, so the
    // default split of the editor route into 16 chunks cost ≈ 13 kB (three.js alone, split out of the editor chunk:
    // +12 kB); the lazy chunk groups (model loader, export path, dialogs, …) stay separate groups.
    experimental: {
      turbopackChunking: {
        requestCost: 10_000_000,
        minChunkSize: 10_000_000,
        maxMergeChunkSize: 10_000_000,
        maxChunkCountPerGroup: 2,
      },
    },
    ...(browserSourceMaps ? { productionBrowserSourceMaps: true } : {}),
    // Workspace packages ship TypeScript sources (`exports` → src/index.ts) and are compiled by the app.
    transpilePackages: [
      '@ekza-studio/anim-core',
      '@ekza-studio/doc',
      '@ekza-studio/rig',
      '@ekza-studio/io',
      '@ekza-studio/mesh-core',
      '@ekza-studio/mesh-view',
      '@ekza-studio/editor-core',
      '@ekza-studio/viewport',
      '@ekza-studio/curve-editor',
      '@ekza-studio/ui',
      '@ekza-studio/editor',
      '@ekza-studio/autorig',
      // STUDIO-TOUCH-SPEC §20.1 (T2): Ekza Studio's Simple layout, imported only by `/app`'s entry group.
      '@ekza-studio/halo',
      // M7 G-b: the generation contract (typed client) and, in server builds only, the gateway route.
      '@ekza-studio/gen-core',
      '@ekza-studio/gen-gateway',
    ],
    // `sharp` is never installed (ADR 0009); images are served as is.
    images: { unoptimized: true },
    // `pnpm typecheck` (tsc -b over the whole workspace) is the type gate; the Next build does not repeat it.
    typescript: { ignoreBuildErrors: true },
    // `next dev` would otherwise write AGENTS.md / CLAUDE.md into apps/web when it detects an AI agent.
    agentRules: false,
  };
}
