// The marquee rectangle, drawn as a DOM box over the pane surface (no GL work while dragging it).
import { normalizeRect } from '../picking/geometry';
import { VIEWPORT_THEME } from '../theme';
import type { MarqueeRect } from '../types';

export class MarqueeBox {
  private box: HTMLDivElement | null = null;

  constructor(private readonly pane: HTMLElement) {}

  show(rect: MarqueeRect | null): void {
    if (rect === null) {
      this.box?.remove();
      this.box = null;
      return;
    }
    if (this.box === null) {
      const box = this.pane.ownerDocument.createElement('div');
      box.dataset['testid'] = 'viewport-marquee';
      Object.assign(box.style, {
        position: 'absolute',
        pointerEvents: 'none',
        border: `1px dashed ${VIEWPORT_THEME.marquee}`,
        background: 'rgba(230, 231, 234, 0.06)',
        zIndex: '20',
      });
      this.pane.append(box);
      this.box = box;
    }
    const r = normalizeRect(rect);
    Object.assign(this.box.style, {
      left: `${r.x0}px`,
      top: `${r.y0}px`,
      width: `${r.x1 - r.x0}px`,
      height: `${r.y1 - r.y0}px`,
    });
  }

  dispose(): void {
    this.show(null);
  }
}
