// The Modeling Tools panel (M6A-SPEC §8.5; B11): an eager wrapper that loads the panel's body
// (`./ToolkitView`, a lazy chunk) on mount; the Toolkit exists only in Model's layout, so Animate never loads it.
import { type JSX, lazy, Suspense } from 'react';
import type { PanelProps } from '../types';

const ToolkitView = lazy(() => import('./ToolkitView'));

/** Layout-critical sizes are inline styles: they hold without the Tailwind stylesheet too. */
const FILL = { width: '100%', height: '100%' } as const;

export function ToolkitPanel(props: PanelProps): JSX.Element {
  return (
    <div style={FILL}>
      <Suspense fallback={null}>
        <ToolkitView {...props} />
      </Suspense>
    </div>
  );
}
