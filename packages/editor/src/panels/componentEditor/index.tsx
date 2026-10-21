// The Component Editor panel body (M6B-SPEC §8; C0 stub, C6 replaces it): a lazy chunk — panels/index.ts registers the
// panel with `lazyPanelDef`, so nothing of this directory is in the editor route.
import type { JSX } from 'react';
import type { PanelProps } from '../types';

export default function ComponentEditorView(_props: PanelProps): JSX.Element {
  return (
    <div className="grid h-full place-items-center p-4 text-ui text-fg-3" data-testid="ce-panel">
      Select points in Skin mode
    </div>
  );
}
