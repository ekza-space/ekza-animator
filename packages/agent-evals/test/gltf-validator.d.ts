// Minimal types for gltf-validator 2.0.0-dev.3.10 (Apache-2.0, no bundled types), used by MVP-AC-1.
declare module 'gltf-validator' {
  export function validateBytes(
    data: Uint8Array,
    options?: { readonly maxIssues?: number; readonly writeTimestamp?: boolean },
  ): Promise<{ readonly issues: { readonly numErrors: number; readonly numWarnings: number } }>;
}
