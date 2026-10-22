// The Paint Skin Weights controls (AUTORIG-SPEC §5.4, §9 CR-AR-1; D0 stub, D4 extracts the body of ./index.tsx here):
// host-agnostic (props `app`, `compact`; no dock imports) — the influence list, Replace / Add / Smooth, value, radius,
// Mirror stroke, Flood, Mirror weights and the inner-points hint — rendered unchanged by the Paint Weights panel and,
// compact, by Auto-Rig's ③ Rig step. The stub renders nothing.
import type { EditorApp } from '@ekza-studio/editor-core';
import type { JSX } from 'react';

export interface PaintWeightsControlsProps {
  readonly app: EditorApp;
  /** The reduced Auto-Rig panel (body-part labels, fewer rows). */
  readonly compact?: boolean;
}

export function PaintWeightsControls(_props: PaintWeightsControlsProps): JSX.Element | null {
  return null;
}
