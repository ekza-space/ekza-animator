import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import humanoidSkeleton from '../../../../../fixtures/synthetic/humanoid-skeleton.json';
import waveDoc from '../../../../../fixtures/synthetic/wave-doc.json';
import { PanelsHarnessIsland } from './PanelsHarnessIsland';

export const metadata: Metadata = {
  title: 'Panel harness',
  robots: { index: false, follow: false },
};

/** Dev/e2e only (MVP-SPEC §7 WP-0b): `next dev`, or a build with NEXT_PUBLIC_EKZA_E2E=1; a 404 everywhere else. */
const ENABLED = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_EKZA_E2E === '1';

/** /dev/panels?panel=<id>: one registered panel with a fake EditorApp over the synthetic wave document. */
export default function DevPanelsPage(): JSX.Element {
  if (!ENABLED) notFound();
  return <PanelsHarnessIsland snapshot={waveDoc} skeleton={humanoidSkeleton} />;
}
