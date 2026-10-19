// @ekza-animator/schematic-render (MCP-SPEC §4.8): a deterministic pure-TypeScript rasteriser for schematic pose tiles
// and curve plots with a PNG encoder. Identical inputs give identical bytes on every platform (integer raster after
// one rounding step, a built-in 5×7 bitmap font, fflate `zlibSync(level 6)`, no PNG timestamps or text chunks).
// D0 lands the types, the colours and stubs (`EkzaError('not-implemented', 'schematic-render.<symbol>')`); P5
// implements them.
import { EkzaError, type Vec3 } from '@ekza-animator/anim-core';

export type Rgba = readonly [number, number, number, number];
export interface SchematicCamera {
  readonly projection: 'perspective' | 'orthographic';
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly fovYDeg: number;
  readonly orthoHeightM: number;
}
export interface SchematicTile {
  readonly rect: readonly [number, number, number, number]; // x, y, w, h in px
  readonly camera: SchematicCamera; // character space
  readonly segments: readonly {
    readonly a: Vec3;
    readonly b: Vec3;
    readonly radiusM: number;
    readonly side: 'L' | 'R' | 'C';
  }[];
  readonly joints: readonly { readonly p: Vec3; readonly radiusM: number; readonly side: 'L' | 'R' | 'C' }[];
  readonly head: { readonly p: Vec3; readonly radiusM: number } | null;
  readonly floorY: number;
  readonly grid: boolean;
  readonly marks: readonly { readonly p: Vec3; readonly kind: 'contact' }[];
  readonly polylines: readonly { readonly points: readonly Vec3[]; readonly color: Rgba; readonly ticks: boolean }[];
  readonly label: string; // ASCII, ≤ 24 characters
}
export interface SchematicScene {
  readonly width: number;
  readonly height: number;
  readonly background: Rgba;
  readonly tiles: readonly SchematicTile[];
}
export interface PlotSpec {
  readonly width: number;
  readonly height: number;
  readonly rangeFrames: readonly [number, number];
  readonly series: readonly {
    readonly label: string;
    readonly unit: 'deg' | 'm' | 'factor';
    readonly points: readonly (readonly [number, number])[];
    readonly keys: readonly (readonly [number, number, boolean /* breakdown */])[];
    readonly dashed: boolean;
  }[]; // ≤ 12 (6 + 6 overlays)
  readonly seamFrame: number | null;
  readonly normalized: boolean;
}

/** Colours: L #4f8dff, R #ff5f69, C #ffd84d (the rig tokens), background #26272b, grid #3a3c44 / #4b4e58, text #e6e7ea. */
export const SCHEMATIC_COLORS: Readonly<
  Record<'L' | 'R' | 'C' | 'background' | 'gridMinor' | 'gridMajor' | 'text' | 'contact', Rgba>
> = {
  L: [0x4f, 0x8d, 0xff, 255],
  R: [0xff, 0x5f, 0x69, 255],
  C: [0xff, 0xd8, 0x4d, 255],
  background: [0x26, 0x27, 0x2b, 255],
  gridMinor: [0x3a, 0x3c, 0x44, 255],
  gridMajor: [0x4b, 0x4e, 0x58, 255],
  text: [0xe6, 0xe7, 0xea, 255],
  // D0 choice (not named in §4.8): a green distinct from the side colours, for contact marks.
  contact: [0x57, 0xe3, 0x89, 255],
};

function notImplemented(symbol: string): never {
  throw new EkzaError('not-implemented', `schematic-render.${symbol}`);
}

export function renderSchematic(_scene: SchematicScene): Uint8Array {
  return notImplemented('renderSchematic');
}
export function renderPlot(_spec: PlotSpec): Uint8Array {
  return notImplemented('renderPlot');
}
export function encodePng(_rgba: Uint8Array, _width: number, _height: number): Uint8Array {
  return notImplemented('encodePng');
}
