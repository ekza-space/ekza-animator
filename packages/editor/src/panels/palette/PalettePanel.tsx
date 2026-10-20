// The Palette panel's eager wrapper (M6A-SPEC §8.8; B13): the body (`PaletteView`) is a lazy chunk that loads the first
// time the tab is shown (dockview keeps inactive tabs mounted with their content detached, so a zero-size box means
// hidden).
import { type JSX, useEffect, useRef, useState } from 'react';
import type { PanelProps } from '../types';
import { LazyBody } from './lazy';

const loadView = () => import('./PaletteView');

const FILL = { width: '100%', height: '100%' } as const;

export function PalettePanel(props: PanelProps): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (element === null) return undefined;
    const check = (): void => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setShown(true);
    };
    const observer = new ResizeObserver(check);
    observer.observe(element);
    check();
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} style={FILL} data-testid="palette-panel" data-instance={props.instanceId}>
      {shown ? <LazyBody name="Palette panel" load={loadView} props={{ app: props.app }} /> : null}
    </div>
  );
}
