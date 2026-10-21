// The Paint Skin Weights brush ring (M6B-SPEC §8.3, §5.12; C6; lazy): a DOM overlay over the viewport in page CSS px —
// the ring (`--brush-ring`) at the pointer with the brush radius, a dashed second ring for Volume reach, the mirror
// partner's ring while the X-mirror stroke is on, and the readout chip under the brush (`0.62 · leftLowerArm`; with
// `Alt` the point's full list). Never pickable (`pointer-events: none`).

export interface BrushRingState {
  /** Page CSS px of the brush centre. */
  readonly x: number;
  readonly y: number;
  /** Radius in CSS px. */
  readonly radius: number;
  readonly volume: boolean;
  /** The mirror partner's ring (page px), or null (no mirror or no partner under the brush). */
  readonly partner: { readonly x: number; readonly y: number; readonly radius: number } | null;
  /** The readout chip's lines (empty: no chip). */
  readonly readout: readonly string[];
  /** Dimmed while the brush cannot paint here (no hit, held influence). */
  readonly idle: boolean;
}

const RING = 'var(--brush-ring, #ffd84d)';

function circle(testId: string, dashed: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset['testid'] = testId;
  Object.assign(el.style, {
    position: 'fixed',
    pointerEvents: 'none',
    borderRadius: '50%',
    border: `1.5px ${dashed ? 'dashed' : 'solid'} ${RING}`,
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.45)',
    zIndex: '30',
    display: 'none',
    boxSizing: 'border-box',
  } satisfies Partial<CSSStyleDeclaration>);
  return el;
}

export class BrushRing {
  private readonly ring = circle('brush-ring', false);
  private readonly volume = circle('brush-ring-volume', true);
  private readonly partner = circle('brush-ring-partner', false);
  private readonly chip = document.createElement('div');
  private shown: BrushRingState | null = null;

  constructor(private readonly parent: HTMLElement = document.body) {
    Object.assign(this.chip.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '31',
      display: 'none',
      padding: '1px 6px',
      borderRadius: '4px',
      background: 'var(--bg-elevated, rgba(20, 21, 24, 0.9))',
      color: 'var(--fg, #e8e8ea)',
      font: '11px/1.4 var(--font-ui, system-ui, sans-serif)',
      whiteSpace: 'pre',
    } satisfies Partial<CSSStyleDeclaration>);
    this.chip.dataset['testid'] = 'brush-readout';
    this.partner.style.opacity = '0.6';
    parent.append(this.ring, this.volume, this.partner, this.chip);
  }

  private place(el: HTMLDivElement, x: number, y: number, r: number): void {
    Object.assign(el.style, {
      display: 'block',
      left: `${x - r}px`,
      top: `${y - r}px`,
      width: `${2 * r}px`,
      height: `${2 * r}px`,
    });
  }

  show(state: BrushRingState): void {
    this.shown = state;
    const r = Math.max(state.radius, 2);
    this.place(this.ring, state.x, state.y, r);
    this.ring.style.opacity = state.idle ? '0.45' : '1';
    if (state.volume) this.place(this.volume, state.x, state.y, r * 0.8);
    else this.volume.style.display = 'none';
    if (state.partner !== null)
      this.place(this.partner, state.partner.x, state.partner.y, Math.max(state.partner.radius, 2));
    else this.partner.style.display = 'none';
    if (state.readout.length > 0) {
      this.chip.textContent = state.readout.join('\n');
      Object.assign(this.chip.style, { display: 'block', left: `${state.x + 8}px`, top: `${state.y + r + 6}px` });
    } else this.chip.style.display = 'none';
  }

  hide(): void {
    this.shown = null;
    for (const el of [this.ring, this.volume, this.partner, this.chip]) el.style.display = 'none';
  }

  /** What is shown (tests). */
  get state(): BrushRingState | null {
    return this.shown;
  }

  dispose(): void {
    this.hide();
    for (const el of [this.ring, this.volume, this.partner, this.chip]) el.remove();
  }
}
