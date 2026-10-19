// The Mesh Check panel's eager wrapper (M6A-SPEC §5.25; B10): the body loads the first time the tab is shown (a
// non-empty box: dockview keeps inactive tabs mounted with their content detached), like the Dope Sheet's.
import { type JSX, lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { PanelProps } from '../types';

const MeshCheckView = lazy(() => import('./MeshCheckView'));

const FILL = { width: '100%', height: '100%' } as const;

export function MeshCheckPanel(props: PanelProps): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (element === null) return undefined;
    const check = (): void => {
      const rect = element.getBoundingClientRect();
      setShown(rect.width > 0 && rect.height > 0);
    };
    const observer = new ResizeObserver(check);
    observer.observe(element);
    check();
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} style={FILL} data-testid="meshcheck-panel">
      {shown ? (
        <Suspense fallback={null}>
          <MeshCheckView app={props.app} />
        </Suspense>
      ) : null}
    </div>
  );
}
