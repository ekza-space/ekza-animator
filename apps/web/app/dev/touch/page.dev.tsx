import type { Metadata } from 'next';
import type { JSX } from 'react';
import { TouchGallery } from './TouchGallery';

export const metadata: Metadata = {
  title: 'Touch kit',
  robots: { index: false, follow: false },
};

/**
 * /dev/touch: the primitive gallery of the touch kit (`@ekza-studio/ui/touch`, STUDIO-TOUCH-SPEC §21 T4). Every
 * primitive in a mock canvas laid out like Ekza Studio's Simple layout, plus one card per primitive. Dev/e2e only,
 * like /dev/panels: the `.dev.tsx` page exists only under `next dev` or in a build with NEXT_PUBLIC_EKZA_E2E=1, so
 * production builds neither serve nor ship it. `apps/web/e2e/dev-touch.spec.ts` checks it (sizes, roles, input).
 */
export default function DevTouchPage(): JSX.Element {
  return <TouchGallery />;
}
