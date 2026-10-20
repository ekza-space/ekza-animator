import type { Metadata } from 'next';
import type { JSX } from 'react';
import { ModelCheckIsland } from './ModelCheckIsland';

export const metadata: Metadata = {
  title: 'Model check',
  robots: { index: false, follow: false },
};

/**
 * /e2e/model-check (M6A-SPEC §9 INT, E2E-MOD-15): loads a GLB with three.js's GLTFLoader — no editor code — and reports
 * what three.js reads: meshes, triangles, vertices, materials and textures. e2e only: the `.dev.tsx` extension is a
 * page only under `next dev` or in a build with NEXT_PUBLIC_EKZA_E2E=1 (see `next.config.ts`), so other builds answer
 * 404 and ship none of it.
 */
export default function ModelCheckPage(): JSX.Element {
  return <ModelCheckIsland />;
}
