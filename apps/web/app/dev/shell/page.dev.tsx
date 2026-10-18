import type { Metadata } from 'next';
import type { JSX } from 'react';
import humanoidSkeleton from '../../../../../fixtures/synthetic/humanoid-skeleton.json';
import waveDoc from '../../../../../fixtures/synthetic/wave-doc.json';
import { ShellHarnessIsland } from './ShellHarnessIsland';

export const metadata: Metadata = {
  title: 'Shell harness',
  robots: { index: false, follow: false },
};

/**
 * /dev/shell: the complete editor shell over a fake EditorApp loaded with the synthetic wave document (MVP-SPEC §7
 * WP-8). Dev/e2e only, like /dev/panels: the `.dev.tsx` page exists only under `next dev` or in a build with
 * NEXT_PUBLIC_EKZA_E2E=1. URL parameters follow the editor's e2e parameters (`?e2e=1&firstRun=1&platform=mac`).
 */
export default function DevShellPage(): JSX.Element {
  return <ShellHarnessIsland snapshot={waveDoc} skeleton={humanoidSkeleton} />;
}
