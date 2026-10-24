// Tolerances of the curve editors by pointer type (STUDIO-TOUCH-SPEC §5.4, ST-8; T1), CSS px: the Graph Editor's hit
// radii (key, tangent handle, curve) and the Dope Sheet's key glyph, region handles and drag slop. The mouse's are
// today's (MVP-SPEC §4.11.18, research 09 §6.2); a finger's and the pen's follow §5.4's pick radius (22 / 9) and slop
// (10 / 4). The Dope Sheet's controller switches its own per event; the Graph Editor's controller is in Studio Pro's
// eager scripts, so a touch shell's curve adapter switches the Graph's (T10) and Pro's mouse never does.
import { DOPE_TOLERANCE } from '../dopesheet/layout';
import { GRAPH_METRICS } from './theme';

export const CURVE_POINTER_TOLERANCE = {
  mouse: { hitKey: 6, hitHandle: 5, hitCurve: 4, glyphPx: 6, regionHandlePx: 6, dragPx: 3 },
  pen: { hitKey: 9, hitHandle: 9, hitCurve: 9, glyphPx: 9, regionHandlePx: 9, dragPx: 4 },
  touch: { hitKey: 22, hitHandle: 22, hitCurve: 22, glyphPx: 22, regionHandlePx: 22, dragPx: 10 },
} as const;

const rowOf = (pointerType: string) =>
  CURVE_POINTER_TOLERANCE[pointerType === 'pen' || pointerType === 'touch' ? pointerType : 'mouse'];

/** The Graph Editor's hit radii for a pointer type (any other type is the mouse). */
export function setGraphPointer(pointerType: string): void {
  const row = rowOf(pointerType);
  GRAPH_METRICS.hitKey = row.hitKey;
  GRAPH_METRICS.hitHandle = row.hitHandle;
  GRAPH_METRICS.hitCurve = row.hitCurve;
}

/** The Dope Sheet's glyph and region tolerances and drag slop for a pointer type (any other type is the mouse). */
export function setDopeSheetPointer(pointerType: string): void {
  const row = rowOf(pointerType);
  DOPE_TOLERANCE.glyphPx = row.glyphPx;
  DOPE_TOLERANCE.regionHandlePx = row.regionHandlePx;
  DOPE_TOLERANCE.dragPx = row.dragPx;
}
