import type { Metadata } from 'next';
import type { JSX } from 'react';
import { CharacterCheckIsland } from './CharacterCheckIsland';

export const metadata: Metadata = {
  title: 'Character check',
  robots: { index: false, follow: false },
};

/**
 * /e2e/character-check (M6B-SPEC §5.22, E2E-SKIN-05, AS-MVP-1 step 11; C10): loads an exported character with
 * three.js + `@pixiv/three-vrm`, resolves every mapped humanoid bone and plays a VRMA idle on it. e2e only: the
 * `.dev.tsx` extension is a page only under `next dev` or in a build with NEXT_PUBLIC_EKZA_E2E=1 (see `next.config.ts`).
 */
export default function CharacterCheckPage(): JSX.Element {
  return <CharacterCheckIsland />;
}
