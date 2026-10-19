// Shared by the M6a test-API owner files (M6A-SPEC §4.8; B0a): the context each group gets and the stub error.
import { EkzaError } from '@ekza-animator/anim-core';
import type { Shell } from '../../shell/types';

export interface M6aTestApiContext {
  readonly shell: Shell;
  /** Applies pending once-per-frame updates before a read. */
  readonly sync: () => void;
}

/** A test-API function whose owner has not landed it yet. */
export function notImplemented(owner: string, name: string): never {
  throw new EkzaError('not-implemented', `editor.testApi.${name} (${owner})`);
}
