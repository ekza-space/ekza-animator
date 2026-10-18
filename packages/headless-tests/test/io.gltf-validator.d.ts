// Minimal types for gltf-validator 2.0.0-dev.3.10 (no bundled types), used by the io.* integration tests.
declare module 'gltf-validator' {
  export function validateBytes(
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
