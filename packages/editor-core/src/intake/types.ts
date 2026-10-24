// The AI intake operators' contract (MODELING-PLAN §7.2 G-a; DECISIONS M7-GA-CONTRACT-*): presets, budgets and the
// outcome every one of `mesh.normalize`, `mesh.reduce`, `mesh.paletteBake`, `mesh.textureDownsize` and `mesh.intake`
// returns. Eager-safe: plain types and constants (the operators' args type in `OperatorMap` reads them).
import type { ParamValues } from '@ekza-studio/anim-core';
import type { MeshId, PaletteId } from '@ekza-studio/doc';
import type { SceneObjectId } from '../types';

/** The budget presets of research 15 D8 (MODELING-PLAN §7.2 G-d uses the same three). */
export type IntakePreset = 'prop' | 'character' | 'hero';

/** Triangle budget per preset: Prop ≤ 500, Character ≤ 3k, Hero ≤ 10k. */
export const INTAKE_BUDGETS: Readonly<Record<IntakePreset, number>> = { prop: 500, character: 3000, hero: 10_000 };

/** Normalize height per preset in `mesh.intake` (Meshy's default `height_meters`); null keeps a prop's size. */
export const INTAKE_HEIGHTS: Readonly<Record<IntakePreset, number | null>> = {
  prop: null,
  character: 1.7,
  hero: 1.7,
};

/** Meshes above this many triangles cannot be made editable (io `MAKE_EDITABLE_MAX_TRIANGLES`, Q-MOD-K-11): the
 *  intake decimates them first. */
export const DECIMATE_FIRST_ABOVE = 200_000;

/** The largest import `mesh.intake {bytes}` decimates (memory guard; the io input budget limits files anyway). */
export const DECIMATE_FIRST_MAX = 4_000_000;

/** Args of the intake operators: their ParamDefs' values plus the targets (and, for `mesh.intake`, a file). */
export type IntakeArgs = ParamValues & {
  /** Explicit targets (mesh ids; group ids stand for their meshes); default: the selected mesh objects. */
  readonly meshes?: readonly SceneObjectId[];
  /** `mesh.intake` only: a GLB to import in the same step (meshes over 200k triangles are decimated first). */
  readonly bytes?: Uint8Array;
  readonly name?: string;
};

/** One step of a run, as the chain reported it. */
export interface IntakeStepOutcome {
  readonly kind: string;
  readonly ms: number;
  readonly trianglesBefore: number;
  readonly trianglesAfter: number;
  readonly facts: Readonly<Record<string, number | string | boolean>>;
}

export interface IntakeOutcome {
  /** The meshes written (imported ones included). */
  readonly meshes: readonly MeshId[];
  /** The palette a palette bake created, else null. */
  readonly palette: PaletteId | null;
  readonly triangles: { readonly before: number; readonly after: number };
  /** Swatches of the baked palette, else null. */
  readonly colours: number | null;
  readonly steps: readonly IntakeStepOutcome[];
  readonly warnings: readonly string[];
  /** Reduce, palette bake or texture downsize ran: invisible AI marks in geometry or textures may be gone (ADR 0017
   *  decision 7; the Generate panel records it in the provenance). */
  readonly aiMarksMayBeAltered: boolean;
  /** The chain ran in the intake worker (false: on this thread). */
  readonly worker: boolean;
  /** Milliseconds of the chain (worker time). */
  readonly ms: number;
}
