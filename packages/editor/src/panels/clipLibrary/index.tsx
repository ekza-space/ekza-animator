// The Clip Library panel body (M6B-SPEC §0.4.7, §8; C12): a lazy chunk — panels/index.ts registers the panel with
// `lazyPanelDef` (C0), so nothing of this directory is in the editor route. Animate shows it as a right-dock tab
// (Windows › Clip Library); Rig & Skin shows the same body in the Rig Toolkit's Clip Library section.
import type { JSX } from 'react';
import { PANEL_ROOT } from '../channels/kit/styles';
import type { PanelProps } from '../types';
import { ClipCardList } from './ClipCardList';

export { ClipCardList, type ClipCardListProps } from './ClipCardList';

export default function ClipLibraryView({ app }: PanelProps): JSX.Element {
  return (
    <div className={`${PANEL_ROOT} p-2`} data-testid="clip-library-panel">
      <ClipCardList app={app} />
    </div>
  );
}
