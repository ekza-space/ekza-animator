// The swatch shader repair (SHADING-SPEC §2, ADR 0019; swatches table version 2), on its own so the table registry's
// v1 → v2 migration does not pull the load-time repairs of ./repair.ts into the eager route (M6B-SPEC §0.4.9: those
// run only in `migrateSnapshot`, which the editor loads lazily).
import { SWATCH_SHADER_DEFAULTS } from '../records';
import { SWATCH_SHADERS } from './validate';

type Obj = Readonly<Record<string, unknown>>;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** A three-integer 0…255 triple, or null when `value` already is one (missing items become `fill`). */
export function repairByteTriple(value: unknown, fill: number): number[] | null {
  const items: readonly unknown[] = Array.isArray(value) ? value : [];
  const fixed = [0, 1, 2].map((i) => {
    const v = items[i];
    return finite(v) ? clamp(Math.round(v), 0, 255) : fill;
  });
  return items.length !== 3 || fixed.some((v, i) => v !== items[i]) ? fixed : null;
}

/**
 * The shader fields of a swatch (SHADING-SPEC §2; swatches table version 2): the patch that repairs them, empty when
 * they are fine. Missing fields take `SWATCH_SHADER_DEFAULTS` (the v1 → v2 migration is this repair); an unknown
 * shader becomes 'lambert'; a glossiness is clamped into 0…1 (0.5 when not a finite number); a malformed specular
 * becomes white, a well-formed one is clamped and rounded.
 */
export function repairSwatchShader(record: Obj, problems: string[] = []): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (!(SWATCH_SHADERS as readonly unknown[]).includes(record['shader'])) {
    problems.push(`shader: ${'shader' in record ? 'unknown' : 'missing'}, set to '${SWATCH_SHADER_DEFAULTS.shader}'`);
    patch['shader'] = SWATCH_SHADER_DEFAULTS.shader;
  }
  const glossiness = record['glossiness'];
  const gloss = finite(glossiness) ? clamp(glossiness, 0, 1) : SWATCH_SHADER_DEFAULTS.glossiness;
  if (gloss !== glossiness) {
    problems.push('glossiness: clamped into 0…1');
    patch['glossiness'] = gloss;
  }
  const specular = record['specular'];
  if (!Array.isArray(specular) || specular.length !== 3) {
    problems.push('specular: missing or malformed, set to white');
    patch['specular'] = [...SWATCH_SHADER_DEFAULTS.specular];
  } else {
    const fixed = repairByteTriple(specular, 255);
    if (fixed !== null) {
      problems.push('specular: clamped and rounded to three integers 0…255');
      patch['specular'] = fixed;
    }
  }
  return patch;
}
