// SPDX-License-Identifier: Apache-2.0
// Copyright Autodesk, Inc. (AnimX); TypeScript port: Ekza Studio contributors. See ../../../NOTICE.
// Licensed under the Apache License, Version 2.0 (../../../LICENSE-APACHE-2.0).
// Internal entry of the AnimX port (https://github.com/Autodesk/animx @ 11c31ac74e526b599031414866db639383c9a5e0).

export {
  BEZIER_CORRECTED,
  BEZIER_STRIDE,
  bezierParameter,
  bezierSlopeAt,
  bezierTimeAt,
  bezierValueAt,
  evaluateBezierSegment,
  prepareBezierSegment,
} from './bezier';
export { evaluateCurveInRange } from './evaluate';
export { evaluateHermiteSegment, HERMITE_STRIDE, hermiteSlope, prepareHermiteSegment } from './hermite';
export { type CyclicInfinity, INFINITY_MAP, mapCyclicInfinity, mapInfinity, snapToKey } from './infinity';
export { horner, polyZeroes } from './polyZeroes';
export { type AnimxAutoType, autoTangentSlope } from './tangents';
