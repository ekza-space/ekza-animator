// The Rig Toolkit's Clip Library section (M6B-SPEC §8.6, §0.4.7; C0 stub, C12): the Clip Library body in the Toolkit
// of Rig & Skin. Collapsed until opened, so entering the workspace loads neither the library UI nor the clip-library
// chunk; opening it loads both (the body as its own lazy chunk, shared with the Animate panel).
import { type JSX, lazy, Suspense, useState } from 'react';
import { BUTTON, MUTED_TEXT } from '../../../channel-box/kit/styles';
import type { RigToolkitSectionProps } from '../types';

const ClipCardList = lazy(() =>
  import('../../../clipLibrary/ClipCardList').then((module) => ({ default: module.ClipCardList })),
);

export function LibrarySection({ app }: RigToolkitSectionProps): JSX.Element {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <span className={MUTED_TEXT}>Preview starter-pack clips on the character</span>
        <button type="button" className={BUTTON} onClick={() => setOpen(true)} data-testid="rtk-library-open">
          Show clips
        </button>
      </div>
    );
  }
  return (
    <Suspense fallback={<div className={MUTED_TEXT}>Loading the Clip Library…</div>}>
      <ClipCardList app={app} compact />
    </Suspense>
  );
}
