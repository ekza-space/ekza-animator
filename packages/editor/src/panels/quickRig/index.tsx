// The Quick Rig panel (M6B-SPEC §0.2, §0.4.2, §8; C3): a lazy chunk — panels/index.ts registers it with
// `lazyPanelDef`, so nothing of this directory is in the editor route. The body is host-agnostic (`./body`); the Rig
// Toolkit's Skeleton section shows the same body while Quick Rig runs.
import type { JSX } from 'react';
import type { PanelProps } from '../types';
import { QuickRigPanelBody } from './body';

export { QuickRigPanelBody, type QuickRigPanelBodyProps } from './body';

export default function QuickRigView(props: PanelProps): JSX.Element {
  return (
    <div className="h-full overflow-auto">
      <QuickRigPanelBody app={props.app} />
    </div>
  );
}
