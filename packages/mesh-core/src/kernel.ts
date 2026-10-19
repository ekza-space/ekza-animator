// The `check-size` marker of the lazy kernel chunk (M6A-SPEC §2, §4.3): a string only kernel code contains. Every
// kernel entry module references it in code that survives tree shaking (`kernelError` puts it into the details of
// every kernel error), so a package that pulls kernel code into the eager editor route fails the size gate's
// `mesh-kernel` boundary the day it does so. Eager code (`./descriptors`) never imports this module.
import { EkzaError } from '@ekza-animator/anim-core';

/** `check-size` marker of the kernel chunk (§2); referenced by every kernel entry module. */
export const KERNEL_MARKER = 'ekza-mesh-kernel' as const;

/** An `EkzaError` raised by kernel code; its details name the kernel (and carry the marker into the bundle). */
export function kernelError(code: string, message: string, details?: Readonly<Record<string, unknown>>): EkzaError {
  return new EkzaError(code, message, { kernel: KERNEL_MARKER, ...details });
}

/** `EkzaError('not-implemented', 'mesh-core.<symbol>')`: a kernel symbol whose owner has not landed it (§3 rule 1). */
export function notImplemented(symbol: string): EkzaError {
  return kernelError('not-implemented', `mesh-core.${symbol}`);
}
