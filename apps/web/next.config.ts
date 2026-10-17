import type { NextConfig } from 'next';

/** `ANIMATOR_STATIC_EXPORT=1` builds a static, server-less editor (GitHub Pages, IPFS, intranet). */
const staticExport = process.env.ANIMATOR_STATIC_EXPORT === '1';

const config: NextConfig = {
  ...(staticExport ? { output: 'export' } : {}),
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

export default config;
