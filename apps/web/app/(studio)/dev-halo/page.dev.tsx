import type { Metadata } from 'next';
import type { JSX } from 'react';
import { HarnessIsland } from './HarnessIsland';

export const metadata: Metadata = {
  title: { absolute: 'Ekza Studio · T6b harness' },
  robots: { index: false, follow: false },
};

/**
 * `/dev-halo` (STUDIO-TOUCH-SPEC §21 T6b; dev and e2e builds only, like `/dev/touch`): the T6b parts — the Path, the
 * sheets and the parity probe — in the `(studio)` group, so a same-page switch to `/app`, `/editor` and `/autorig`
 * keeps the host and its EditorApp (the browser parity spec takes one census per mount). The `.dev.tsx` page exists
 * only under `next dev` or in a build with NEXT_PUBLIC_EKZA_E2E=1. Removed once T6a's frame hosts the sheets (T12).
 */
export default function DevHaloPage(): JSX.Element {
  return <HarnessIsland />;
}
