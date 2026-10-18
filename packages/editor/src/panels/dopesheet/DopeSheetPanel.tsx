// The Dope Sheet panel (M2A-SPEC §5.10, §7): an eager wrapper that registers the Dope Sheet contributions
// (`dopeSheet.frame`, the Q/W/R tools, the ripple control set) while mounted and loads the panel's body through a
// `React.lazy` boundary the first time its dock tab is shown (§5.21.2 required lazy boundary 4): the controller,
// painter and toolbar code stay out of the editor's initial route. Dockview keeps an inactive tab mounted with its
// content detached, so "shown" is a non-empty size of the panel's box.
import { registerDopeSheetContributions } from '@ekza-animator/curve-editor';
import { type JSX, lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { PanelProps } from '../types';
import { focusedDopeSheet } from './focus';

const DopeSheetView = lazy(() => import('./DopeSheetView'));

export function DopeSheetPanel(props: PanelProps): JSX.Element {
  const { app, instanceId } = props;
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (app.operators.get('dopeSheet.frame') !== undefined) return undefined;
    return registerDopeSheetContributions(app, () => focusedDopeSheet(app)?.controller ?? null);
  }, [app]);

  useEffect(() => {
    const element = box.current;
    if (element === null || shown) return undefined;
    const check = (): void => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setShown(true);
    };
    const observer = new ResizeObserver(check);
    observer.observe(element);
    check();
    return () => observer.disconnect();
  }, [shown]);

  return (
    <div ref={box} className="h-full w-full" data-testid="ds-panel">
      {shown ? (
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-ui text-fg-3" data-testid="ds-loading">
              Loading the Dope Sheet…
            </div>
          }
        >
          <DopeSheetView app={app} instanceId={instanceId} />
        </Suspense>
      ) : null}
    </div>
  );
}
