// Halo-only form data (STUDIO-TOUCH-SPEC §5.6, §20.3 item 6, §20.4; T5a): the types of a pre-run form. A `FormDef` is
// typed against `OperatorMap` with `satisfies`: every param names an argument of its operator — a top-level field, or
// a dotted path into an object argument (`tolerance.rotationRad`, `params.speed`), because a ParamDef is a scalar
// (M6A-SPEC §4.1: compound values are flattened per component) — and its kind, default and options fit that
// argument's type. A form that names a field the operator does not take, or an enum value it does not accept, does
// not compile (§20.5 test 9: "a FormDef that type-checks").
import type { ParamDef, ParamKind, ParamValue } from '@ekza-studio/anim-core';
import type { OperatorMap } from '../operators/args';

type NumericKind = 'number' | 'int' | 'distance' | 'angle' | 'fraction';
type Defined<V> = Exclude<V, undefined | null>;
type Depth = [never, 0, 1, 2];

/** The args object of an operator (`void` and `undefined` removed; `never` when it takes no arguments). */
export type FormArgs<K extends keyof OperatorMap> = Exclude<OperatorMap[K]['args'], void | undefined>;

/** An object argument a path may go into (not an array, a byte buffer or a branded id). */
type Nested<T> = T extends readonly unknown[] | Uint8Array | string | number | boolean
  ? never
  : T extends object
    ? T
    : never;

/** Dotted paths to the fields of an args object, at most three levels deep. */
export type ArgPath<T, D extends number = 3> = [D] extends [never]
  ? never
  : T extends object
    ? {
        [P in keyof T & string]-?:
          | P
          | ([Nested<Defined<T[P]>>] extends [never] ? never : `${P}.${ArgPath<Nested<Defined<T[P]>>, Depth[D]>}`);
      }[keyof T & string]
    : never;

/** The type of the argument at a dotted path. */
export type ArgAt<T, P extends string> = T extends object
  ? P extends `${infer Head}.${infer Rest}`
    ? Head extends keyof T
      ? ArgAt<Defined<T[Head]>, Rest>
      : never
    : P extends keyof T
      ? T[P]
      : never
  : never;

/** The ParamDef kinds that can stand for an argument type (numbers: the numeric kinds; objects and text: 'data'). */
export type KindFor<V> = [Defined<V>] extends [never]
  ? ParamKind
  : [Defined<V>] extends [number]
    ? NumericKind
    : [Defined<V>] extends [boolean]
      ? 'bool'
      : [Defined<V>] extends [string]
        ? string extends Defined<V>
          ? 'data'
          : 'enum' | 'axis' | 'data'
        : 'data';

/** The default a param of that argument type may carry (null: "auto", with `nullable`). */
export type DefaultFor<V> = [Defined<V>] extends [number]
  ? number | null
  : [Defined<V>] extends [boolean]
    ? boolean | null
    : [Defined<V>] extends [string]
      ? string extends Defined<V>
        ? ParamValue
        : Extract<Defined<V>, string> | null
      : ParamValue;

/** The option values an enum param of that argument type may offer. */
export type OptionFor<V> = [Defined<V>] extends [string] ? Extract<Defined<V>, string> : string;

/** One param of a form for operator K: a ParamDef whose name, kind, default and options fit K's arguments. */
export type FormParam<K extends keyof OperatorMap> = {
  [P in ArgPath<FormArgs<K>>]: Omit<ParamDef, 'name' | 'kind' | 'default' | 'options'> & {
    readonly name: P;
    readonly kind: KindFor<ArgAt<FormArgs<K>, P>>;
    readonly default: DefaultFor<ArgAt<FormArgs<K>, P>>;
    readonly options?: readonly { readonly value: OptionFor<ArgAt<FormArgs<K>, P>>; readonly label: string }[];
  };
}[ArgPath<FormArgs<K>>];

/**
 * Session values a run reads, shown read-only in the form (§5.6: *"at 0.50 s · Forearm R"*): `time` — the playhead
 * or the time band; `target` — the thing the verb acts on (the selection, the active animation, a picked target, the
 * copied pose).
 */
export type FormSessionValue = 'time' | 'target';

/**
 * A pre-run form (§20.4): the operator, its params, and the session values it reads. `base` holds argument values the
 * form always starts from (a whole object argument whose other fields the form does not show, e.g. the identity clip
 * parameters under a speed chip).
 */
export interface FormDef<K extends keyof OperatorMap> {
  readonly id: K;
  readonly params: readonly FormParam<K>[];
  readonly fromSession?: readonly FormSessionValue[];
  readonly base?: Partial<FormArgs<K>>;
}

/** A form as the touch shell reads it at run time (its operator id erased). */
export interface AnyFormDef {
  readonly id: string;
  readonly params: readonly ParamDef[];
  readonly fromSession: readonly FormSessionValue[];
  readonly base: Readonly<Record<string, unknown>>;
}

/**
 * What the touch shell shows before a run (§5.6): the operator's form (`source: 'form'`), or the ParamDefs of an
 * operator that declares them but cannot be adjusted after the run (`source: 'params'`, the option box's fields).
 */
export interface FormView extends AnyFormDef {
  readonly source: 'form' | 'params';
}
