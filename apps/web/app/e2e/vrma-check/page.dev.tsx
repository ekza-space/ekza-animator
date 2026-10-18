import type { Metadata } from 'next';
import type { JSX } from 'react';
import { VrmaCheckIsland } from './VrmaCheckIsland';

export const metadata: Metadata = {
  title: 'VRMA check',
  robots: { index: false, follow: false },
};

/**
 * /e2e/vrma-check (MVP-SPEC §7 WP-10, E2E-17): loads Seed-san and Polybot with three.js + `@pixiv/three-vrm`, plays a
 * VRMA through `@pixiv/three-vrm-animation` and returns the normalized bone rotations. e2e only: the `.dev.tsx`
 * extension is a page only under `next dev` or in a build with NEXT_PUBLIC_EKZA_E2E=1 (see `next.config.ts`), so other
 * builds answer 404 and ship none of it.
 */
export default function VrmaCheckPage(): JSX.Element {
  return <VrmaCheckIsland />;
}
