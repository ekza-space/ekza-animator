// The FormDef type (STUDIO-TOUCH-SPEC §20.4, §20.5 test 9; T5a): a form type-checks only when every param names an
// argument of its operator (dotted into object arguments), with a kind, default and options that fit the argument's
// type. The `@ts-expect-error` lines are compile-time tests (`pnpm typecheck` fails when one of them compiles).
import type { ParamDef } from '@ekza-studio/anim-core';
import { describe, expect, it } from 'vitest';
import type { ArgPath, FormArgs, FormDef } from '../../src/forms';

const value = { bound: 'value' } as const;

/** Never called: the checks are in the types. */
export function typeChecks(): readonly unknown[] {
  return [
    {
      id: 'graph.curves.simplify',
      params: [{ ...value, name: 'tolerance.rotationRad', label: 'R', kind: 'angle', default: 0.001 }],
    } satisfies FormDef<'graph.curves.simplify'>,
    {
      id: 'graph.curves.simplify',
      // @ts-expect-error -- not a path of `{ tolerance?: ReduceSpec }`
      params: [{ ...value, name: 'tolerance.rotation', label: 'R', kind: 'angle', default: 0.001 }],
    } satisfies FormDef<'graph.curves.simplify'>,
    {
      id: 'graph.infinity.set',
      // @ts-expect-error -- an InfinityMode is an enum, not a number
      params: [{ ...value, name: 'pre', label: 'Pre', kind: 'number', default: 1 }],
    } satisfies FormDef<'graph.infinity.set'>,
    {
      id: 'graph.infinity.set',
      params: [
        {
          ...value,
          name: 'pre',
          label: 'Pre',
          kind: 'enum',
          default: 'cycle',
          // @ts-expect-error -- 'bounce' is not an InfinityMode
          options: [{ value: 'bounce', label: 'B' }],
        },
      ],
    } satisfies FormDef<'graph.infinity.set'>,
    {
      id: 'clip.new',
      // @ts-expect-error -- `loop` is a boolean
      params: [{ ...value, name: 'loop', label: 'Loop', kind: 'bool', default: 3 }],
    } satisfies FormDef<'clip.new'>,
    {
      id: 'graph.eulerFilter',
      // @ts-expect-error -- the operator takes no arguments
      params: [{ ...value, name: 'tolerance', label: 'T', kind: 'number', default: 1 }],
    } satisfies FormDef<'graph.eulerFilter'>,
    {
      id: 'pose.lookAt',
      params: [{ ...value, name: 'weight', label: 'W', kind: 'fraction', default: 1 }],
    } satisfies FormDef<'pose.lookAt'>,
    {
      id: 'pose.lookAt',
      // @ts-expect-error -- the form of one operator cannot name another's arguments
      params: [{ ...value, name: 'factor', label: 'F', kind: 'number', default: 1 }],
    } satisfies FormDef<'pose.lookAt'>,
  ];
}

type Paths = ArgPath<FormArgs<'library.useClip'>>;
const PATHS: readonly Paths[] = [
  'character',
  'clip',
  'params',
  'params.speed',
  'params.trim',
  'params.trim.end',
  'replace',
];

describe('FormDef typing', () => {
  it('erases to ParamDefs and lists dotted argument paths', () => {
    const form = typeChecks()[0] as FormDef<'graph.curves.simplify'>;
    const params: readonly ParamDef[] = form.params;
    expect(params[0]?.name).toBe('tolerance.rotationRad');
    expect(PATHS).toContain('params.speed');
  });
});
