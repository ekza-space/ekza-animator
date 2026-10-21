// The Clip Library panel body (M6B-SPEC §8; C0 stub, C12 replaces it): a lazy chunk with the panel's empty state.
import type { JSX } from 'react';
import type { PanelProps } from '../types';

export default function ClipLibraryView(_props: PanelProps): JSX.Element {
  return (
    <div className="grid h-full place-items-center p-4 text-ui text-fg-3" data-testid="clip-library-panel">
      Select a humanoid character (a VRM, or one you rigged here) to preview clips
    </div>
  );
}
