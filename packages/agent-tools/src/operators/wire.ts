// Operator wire schemas (MCP-SPEC §5.14): one strict zod object per allowed or confirm operator, in the operator's own
// units, without the `label` argument (the tool layer sets labels, §5.6). D0 lands the type; P3 fills `OPERATOR_WIRE`
// (coverage, drift and example tests).
import type { CharacterId } from '@ekza-animator/doc';
import type { OperatorArgs, OperatorMap } from '@ekza-animator/editor-core';
import type { z } from 'zod';
import type { Resolver } from '../types';

export type WireUnit = 'rad' | 'deg' | 'm' | 'factor' | 'frames' | 'percent' | 'px' | 'none';
export interface OperatorWire<K extends keyof OperatorMap> {
  readonly schema: z.ZodObject; // what the agent sends: names allowed, the operator's own units
  readonly units: Readonly<Record<string, WireUnit>>; // per numeric field path
  readonly example: Readonly<Record<string, unknown>>; // validates against `schema` (lint)
  toArgs(wire: z.output<this['schema']>, r: Resolver, character: CharacterId): OperatorArgs<K>; // names → branded ids
}
export type OperatorWireMap = { readonly [K in keyof OperatorMap]?: OperatorWire<K> };

/** Every wire schema, by operator id (P3). */
export const OPERATOR_WIRE: OperatorWireMap = {};
