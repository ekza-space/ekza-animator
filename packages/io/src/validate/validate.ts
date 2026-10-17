// glTF-Validator wrapper and the surgeon's validation policy (MVP-SPEC §4.11.13). io never imports gltf-validator
// itself (it is a devDependency here and a dependency of the editor's validator worker only, ARCHITECTURE §3): the
// host installs the module once with `setGltfValidator(await import('gltf-validator'))` — tests in their setup, the
// worker (M1-stretch) at start-up.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ValidationIssue, ValidationReport } from '../types';

export { readBackCheck } from './readBack';

/** The part of the `gltf-validator` module API that `validateGltf` uses. */
export interface GltfValidatorModule {
  validateBytes(
    data: Uint8Array,
    options?: {
      readonly format?: 'glb' | 'gltf';
      readonly maxIssues?: number;
      readonly ignoredIssues?: readonly string[];
      readonly writeTimestamp?: boolean;
    },
  ): Promise<{
    readonly issues: {
      readonly numErrors: number;
      readonly numWarnings: number;
      readonly numInfos: number;
      readonly messages: readonly {
        readonly code: string;
        readonly message: string;
        readonly severity: number;
        readonly pointer?: string;
      }[];
    };
  }>;
}

let validator: GltfValidatorModule | null = null;

/** Installs (or, with null, removes) the glTF-Validator implementation used by `validateGltf`. */
export function setGltfValidator(module: GltfValidatorModule | null): void {
  validator = module;
}

/**
 * Khronos glTF-Validator report of a GLB. `UNSUPPORTED_EXTENSION` (VRM extensions) is ignored; `maxIssues`
 * defaults to unlimited so reports can be compared (`compareValidation`).
 */
export async function validateGltf(
  bytes: Uint8Array,
  opts?: { readonly maxIssues?: number },
): Promise<ValidationReport> {
  if (validator === null) {
    throw new EkzaError(
      'unsupported',
      "No glTF-Validator installed: call setGltfValidator(await import('gltf-validator'))",
    );
  }
  const report = await validator.validateBytes(bytes, {
    format: 'glb',
    maxIssues: opts?.maxIssues ?? 0,
    ignoredIssues: ['UNSUPPORTED_EXTENSION'],
    writeTimestamp: false,
  });
  const issues: ValidationIssue[] = report.issues.messages.map((message) => ({
    code: message.code,
    severity: clampSeverity(message.severity),
    message: message.message,
    ...(message.pointer === undefined ? {} : { pointer: message.pointer }),
  }));
  return {
    errors: report.issues.numErrors,
    warnings: report.issues.numWarnings,
    infos: report.issues.numInfos,
    issues,
  };
}

function clampSeverity(severity: number): ValidationIssue['severity'] {
  return severity <= 0 ? 0 : severity >= 3 ? 3 : (severity as 1 | 2);
}

/** Error-severity issues of `output` whose (code, pointer) is absent from `source` (§4.11.13). */
export function compareValidation(source: ValidationReport, output: ValidationReport): readonly ValidationIssue[] {
  const known = new Set(source.issues.map((issue) => `${issue.code}\u0000${issue.pointer ?? ''}`));
  return output.issues.filter(
    (issue) => issue.severity === 0 && !known.has(`${issue.code}\u0000${issue.pointer ?? ''}`),
  );
}
