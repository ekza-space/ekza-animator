// Primitive parameters (M6A-SPEC §6.3): the low-poly defaults are the `ParamDef` defaults (prefs.modeling
// .primitiveDefaults 'low-poly'); `DCC_PRIMITIVE_DEFAULTS` holds the classic desktop-DCC set (preference 'dcc'). Every
// param is value-bound; the primary field is the first subdivision count (humanoidBody: height). Plane lies in XZ
// facing +Y; cylinder, cone and torus axes along +Y; all centred at the origin. Eager: plain data.
import type { ParamDef, ParamValues } from '@ekza-studio/anim-core';
import { distance, enumOf, int } from './paramKit';
import type { PrimitiveKind } from './types';

const LENGTH = { min: 1e-4 } as const;

const cube: readonly ParamDef[] = [
  distance('width', 'Width', 1, LENGTH),
  distance('height', 'Height', 1, LENGTH),
  distance('depth', 'Depth', 1, LENGTH),
  int('subdivisionsWidth', 'Subdivisions Width', 1, { min: 1, max: 64, primary: true }),
  int('subdivisionsHeight', 'Subdivisions Height', 1, { min: 1, max: 64 }),
  int('subdivisionsDepth', 'Subdivisions Depth', 1, { min: 1, max: 64 }),
];

const sphere: readonly ParamDef[] = [
  distance('radius', 'Radius', 0.5, LENGTH),
  int('subdivisionsAxis', 'Subdivisions Axis', 12, { min: 3, max: 128, primary: true }),
  int('subdivisionsHeight', 'Subdivisions Height', 8, { min: 2, max: 128 }),
];

const cylinder: readonly ParamDef[] = [
  distance('radius', 'Radius', 0.5, LENGTH),
  distance('height', 'Height', 1, LENGTH),
  int('subdivisionsAxis', 'Subdivisions Axis', 8, { min: 3, max: 128, primary: true }),
  int('subdivisionsHeight', 'Subdivisions Height', 1, { min: 1, max: 128 }),
  int('subdivisionsCaps', 'Subdivisions Caps', 0, {
    min: 0,
    max: 16,
    description: '0 = one n-gon cap',
  }),
];

const cone: readonly ParamDef[] = [
  distance('radius', 'Radius', 0.5, LENGTH),
  distance('height', 'Height', 1, LENGTH),
  int('subdivisionsAxis', 'Subdivisions Axis', 8, { min: 3, max: 128, primary: true }),
  int('subdivisionsHeight', 'Subdivisions Height', 1, { min: 1, max: 128 }),
  int('subdivisionsCaps', 'Subdivisions Caps', 0, { min: 0, max: 16, description: '0 = one n-gon cap' }),
];

const plane: readonly ParamDef[] = [
  distance('width', 'Width', 1, LENGTH),
  distance('height', 'Height', 1, LENGTH),
  int('subdivisionsWidth', 'Subdivisions Width', 1, { min: 1, max: 256, primary: true }),
  int('subdivisionsHeight', 'Subdivisions Height', 1, { min: 1, max: 256 }),
];

const torus: readonly ParamDef[] = [
  distance('radius', 'Radius', 0.5, LENGTH),
  distance('sectionRadius', 'Section Radius', 0.2, LENGTH),
  int('subdivisionsAxis', 'Subdivisions Axis', 12, { min: 3, max: 128, primary: true }),
  int('subdivisionsHeight', 'Subdivisions Height', 6, { min: 3, max: 128 }),
];

const humanoidBody: readonly ParamDef[] = [
  distance('height', 'Height', 1.6, { min: 0.5, max: 3, primary: true }),
  enumOf(
    'style',
    'Style',
    [
      ['smooth', 'Smooth'],
      ['segmented', 'Segmented'],
    ],
    'smooth',
  ),
];

/** §6.3 parameters per primitive kind (low-poly defaults). */
export const PRIMITIVE_PARAMS: Readonly<Record<PrimitiveKind, readonly ParamDef[]>> = Object.freeze({
  cube,
  sphere,
  cylinder,
  cone,
  plane,
  torus,
  humanoidBody,
});

/** §6.3 classic desktop-DCC defaults, 20-segment spheres and the like (preference `primitiveDefaults: 'dcc'`). */
export const DCC_PRIMITIVE_DEFAULTS: Readonly<Record<PrimitiveKind, ParamValues>> = Object.freeze({
  cube: { width: 1, height: 1, depth: 1, subdivisionsWidth: 1, subdivisionsHeight: 1, subdivisionsDepth: 1 },
  sphere: { radius: 0.5, subdivisionsAxis: 20, subdivisionsHeight: 20 },
  cylinder: { radius: 1, height: 2, subdivisionsAxis: 20, subdivisionsHeight: 1, subdivisionsCaps: 0 },
  cone: { radius: 1, height: 2, subdivisionsAxis: 20, subdivisionsHeight: 1, subdivisionsCaps: 0 },
  plane: { width: 1, height: 1, subdivisionsWidth: 10, subdivisionsHeight: 10 },
  torus: { radius: 1, sectionRadius: 0.5, subdivisionsAxis: 20, subdivisionsHeight: 20 },
  humanoidBody: { height: 1.6, style: 'smooth' },
});
