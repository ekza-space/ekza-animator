// Contract file: MVP-SPEC §4.7 with the M2A-SPEC §4.7 additions, copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { Frame } from '@ekza-animator/anim-core';
import type { ChannelId, ControlId, CurveId, KeyId } from '@ekza-animator/doc';
import type { BodyPart, GraphViewMode } from '@ekza-animator/editor-core';

/** x = (frame − f0)·sx ;  y = heightCss − (displayValue − v0)·sy  (displayValue: degrees for r*, metres for t*). */
export interface GraphViewState { readonly f0: number; readonly v0: number; readonly sx: number; readonly sy: number }
export type GraphHit =
  | { readonly kind: 'handle'; readonly key: KeyId; readonly curve: CurveId; readonly side: 'in' | 'out' }
  | { readonly kind: 'key'; readonly key: KeyId; readonly curve: CurveId }
  | { readonly kind: 'curve'; readonly curve: CurveId; readonly frame: number; readonly value: number }
  | { readonly kind: 'none'; readonly frame: number; readonly value: number };
export interface ChannelTreeNode {
  readonly id: string;                         // control id or `${controlId}/${channel}`
  readonly kind: 'character' | 'control' | 'channel';
  readonly label: string;
  readonly control?: ControlId;
  readonly channel?: ChannelId;
  readonly curve?: CurveId;                    // channel rows with a curve in the active clip
  readonly color: string;                      // swatch (X red, Y green, Z blue, other cyan)
  readonly children: readonly ChannelTreeNode[];
}
/** Time slider hit-test (active-clip frames). */
export type TimeSliderHit =
  | { readonly kind: 'band-start' | 'band-end' | 'band-middle'; readonly frame: Frame }
  | { readonly kind: 'tick'; readonly frame: Frame }
  | { readonly kind: 'ruler'; readonly frame: Frame };

// ---------- M2a: Dope Sheet, Graph Editor views (M2A-SPEC §4.7) ----------
export type DopeSheetRowKind = 'summary' | 'character' | 'group' | 'control' | 'channel';
export interface DopeSheetRow {
  readonly id: string;                         // 'summary' | `chr:${id}` | `grp:${chr}:${part}` | control id | `${control}/${channel}`
  readonly kind: DopeSheetRowKind;
  readonly label: string;
  readonly depth: number;
  readonly group?: BodyPart;
  readonly control?: ControlId;
  readonly channel?: ChannelId;
  readonly curves: readonly CurveId[];         // curves under the row (active clip, base layer)
  readonly expanded: boolean;
  readonly dimmed: boolean;                    // control hidden by the IK/FK rule (§5.5)
}
export interface DopeSheetViewState { readonly f0: number; readonly sx: number; readonly scrollY: number }
export type DopeSheetHit =
  | { readonly kind: 'glyph'; readonly row: string; readonly frame: Frame }
  | { readonly kind: 'region-start' | 'region-end' | 'region-middle'; readonly frame: Frame }
  | { readonly kind: 'ruler'; readonly frame: Frame }
  | { readonly kind: 'none'; readonly row: string | null; readonly frame: Frame };
export type RegionHandle = 'left' | 'right' | 'top' | 'bottom' | 'tl' | 'tr' | 'bl' | 'br' | 'inside';
export type { GraphViewMode };
