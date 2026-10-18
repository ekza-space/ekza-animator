// Contract file: MVP-SPEC §4.7, copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { Frame } from '@ekza-animator/anim-core';
import type { ChannelId, ControlId, CurveId, KeyId } from '@ekza-animator/doc';

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
