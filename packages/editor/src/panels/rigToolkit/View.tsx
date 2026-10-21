// The Rig Toolkit panel body (M6B-SPEC §8.6; C0 stub frame, C7 replaces it with the checklist, header and footer): a
// lazy chunk that renders the registered sections (./sections) under their titles.
import type { JSX } from 'react';
import type { PanelProps } from '../types';
import { RIG_TOOLKIT_SECTIONS } from './sections';

export default function RigToolkitView(props: PanelProps): JSX.Element {
  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-2 text-ui text-fg-2" data-testid="rtk-panel">
      {RIG_TOOLKIT_SECTIONS.map((section) => (
        <section key={section.id} data-testid={`rtk-section-${section.id}`}>
          <h3 className="font-semibold text-fg">{section.title}</h3>
          <section.component app={props.app} />
        </section>
      ))}
    </div>
  );
}
