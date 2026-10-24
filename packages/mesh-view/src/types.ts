// Contract file: M6A-SPEC §4.4 (mesh-view types), copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec. The §4.4 classes live in
// implementation modules (B0a: the skeleton in ./index.ts; B6 the bodies).
import type { ComponentKind, HiddenSet } from '@ekza-studio/mesh-core';

/** Colours resolved from the design tokens (§8.9), never literals. */
export interface MeshViewTheme {
  readonly halo: number; readonly vertex: number; readonly selected: number; readonly hover: number;
  readonly wire: number; readonly wireMode: number; readonly hardEdge: number;
  readonly normalFace: number; readonly normalVertex: number; readonly faceFront: number; readonly faceBack: number;
  readonly symPlane: number; readonly lintNgon: number; readonly lintError: number;
  readonly soft: readonly [number, number, number, number];
}
/** Per-pane display state the viewport applies before it renders a pane (one scene, N cameras). */
export interface MeshPaneDisplay {
  readonly shading: 'wire' | 'shaded' | 'colours' | 'lit';
  readonly wireOnShaded: boolean; readonly flat: boolean; readonly cull: boolean; readonly xray: boolean;
  readonly components: boolean; readonly normals: 'off' | 'face' | 'vertex' | 'both'; readonly faceOrientation: boolean;
  readonly triangulation: boolean; readonly hardEdges: boolean; readonly meshCheck: boolean;
  readonly symmetryPlane: boolean; readonly dimmed: boolean;   // dimmed = not hilited and the pane's Dim unhilited is on
  readonly xrayOpacity?: number;   // STUDIO-TOUCH-SPEC §20.3 item 17: a display overlay's x-ray opacity (absent: the style's 0.5)
}
export interface MeshViewLayers { readonly surface: number; readonly components: number; readonly normals: number;
  readonly lint: number; readonly helpers: number }   // viewport LAYER values (§4.7)
export interface PickHit {
  readonly kind: ComponentKind;
  readonly index: number;
  readonly t: number | null;                 // edge parameter from edgeVert(e, 0) (edges only)
  readonly point: readonly [number, number, number];   // world
  readonly distancePx: number;
}
export interface PickOptions {
  readonly cameraBased: boolean;             // occlusion test on
  readonly backfaces: boolean;
  readonly hidden: HiddenSet | null;
  readonly radiusPx?: number;                // vertex 8, edge 6 (defaults)
  readonly wire?: boolean;                   // the pane draws no surface: faces pick by their dot only (§5.6; INT)
}
