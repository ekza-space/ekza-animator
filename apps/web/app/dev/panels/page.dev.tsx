import type { Metadata } from 'next';
import type { JSX } from 'react';
import humanoidSkeleton from '../../../../../fixtures/synthetic/humanoid-skeleton.json';
import waveDoc from '../../../../../fixtures/synthetic/wave-doc.json';
import { PanelsHarnessIsland } from './PanelsHarnessIsland';

export const metadata: Metadata = {
  title: 'Panel harness',
  robots: { index: false, follow: false },
};

/**
 * /dev/panels?panel=<id>: one registered panel with a fake EditorApp over the synthetic wave document.
 * Dev/e2e only (MVP-SPEC §7 WP-0b): the `.dev.tsx` extension is a page only under `next dev` or in a build with
 * NEXT_PUBLIC_EKZA_E2E=1 (see `next.config.ts`), so other builds neither serve nor ship it.
 */
export default function DevPanelsPage(): JSX.Element {
  return <PanelsHarnessIsland snapshot={waveDoc} skeleton={humanoidSkeleton} />;
}
