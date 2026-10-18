import type { NextConfig } from 'next';

/** `PHASE_DEVELOPMENT_SERVER` of `next/constants` (config files may import only `next` itself). */
const PHASE_DEVELOPMENT_SERVER = 'phase-development-server';

/** `ANIMATOR_STATIC_EXPORT=1` builds a static, server-less editor (GitHub Pages, IPFS, intranet). */
const staticExport = process.env.ANIMATOR_STATIC_EXPORT === '1';

const PAGE_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js'];
/**
 * Dev/e2e-only routes (`app/dev/**`) are `page.dev.tsx` files: Next treats them as pages only under `next dev` or
 * in a build with NEXT_PUBLIC_EKZA_E2E=1, so normal builds and static exports neither route to nor bundle the test kit.
 */
const DEV_PAGE_EXTENSIONS = [...PAGE_EXTENSIONS, 'dev.tsx'];

export default function nextConfig(phase: string): NextConfig {
  const devRoutes = phase === PHASE_DEVELOPMENT_SERVER || process.env.NEXT_PUBLIC_EKZA_E2E === '1';
  return {
    ...(staticExport ? { output: 'export' } : {}),
    pageExtensions: devRoutes ? DEV_PAGE_EXTENSIONS : PAGE_EXTENSIONS,
    reactStrictMode: true,
    // Workspace packages ship TypeScript sources (`exports` → src/index.ts) and are compiled by the app.
    transpilePackages: [
      '@ekza-animator/anim-core',
      '@ekza-animator/doc',
      '@ekza-animator/rig',
      '@ekza-animator/io',
      '@ekza-animator/editor-core',
      '@ekza-animator/viewport',
      '@ekza-animator/curve-editor',
      '@ekza-animator/ui',
      '@ekza-animator/editor',
    ],
    // `sharp` is never installed (ADR 0009); images are served as is.
    images: { unoptimized: true },
    // `pnpm typecheck` (tsc -b over the whole workspace) is the type gate; the Next build does not repeat it.
    typescript: { ignoreBuildErrors: true },
    // `next dev` would otherwise write AGENTS.md / CLAUDE.md into apps/web when it detects an AI agent.
    agentRules: false,
  };
}
