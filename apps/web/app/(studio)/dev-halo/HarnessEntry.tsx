'use client';

import { StudioHost } from '@ekza-studio/editor/host';
// The harness subpath is dev-only and not in the `apps/web/app/**` allow-list (T2's `.oxlintrc.json`): T6b's
// docs/wp-notes/halo-t6b.md, patch P-T6B-1.
// oxlint-disable-next-line no-restricted-imports
import { HaloT6bHarness } from '@ekza-studio/halo/dev';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { hostProps } from '../hostProps';
import { useShellEntry } from '../StudioHostIsland';

/** `/dev-halo`'s entry: the page's host and the T6b harness shell, registered with the `(studio)` layout. */
export function HarnessEntry(): null {
  const router = useRouter();
  const entry = useMemo(
    () => ({ Host: StudioHost, Shell: HaloT6bHarness, props: hostProps((href) => router.push(href)) }),
    [router],
  );
  useShellEntry(entry);
  return null;
}
