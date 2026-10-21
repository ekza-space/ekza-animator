// The Quick Rig panel body (M6B-SPEC §8; C0 stub, C3 replaces it): a lazy chunk with the panel's empty state.
import type { JSX } from 'react';
import type { PanelProps } from '../types';

export default function QuickRigView(_props: PanelProps): JSX.Element {
  return (
    <div className="grid h-full place-items-center p-4 text-ui text-fg-3" data-testid="quickrig-panel">
      Quick Rig places markers on the selected meshes
    </div>
  );
}
