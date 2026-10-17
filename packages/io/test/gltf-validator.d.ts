// Type declarations for the parts of gltf-validator 2.0.0-dev.3.10 (Apache-2.0, no bundled types) that io uses.
declare module 'gltf-validator' {
  export interface ValidationOptions {
    readonly uri?: string;
    readonly format?: 'glb' | 'gltf';
    /** 0 = unlimited. */
    readonly maxIssues?: number;
    readonly ignoredIssues?: readonly string[];
    readonly onlyIssues?: readonly string[];
    readonly severityOverrides?: Readonly<Record<string, number>>;
    readonly externalResourceFunction?: (uri: string) => Promise<Uint8Array>;
    readonly writeTimestamp?: boolean;
  }
  export interface ValidatorMessage {
    readonly code: string;
    readonly message: string;
    /** 0 error, 1 warning, 2 info, 3 hint. */
    readonly severity: number;
    readonly pointer?: string;
    readonly offset?: number;
  }
  export interface ValidatorReport {
    readonly issues: {
      readonly numErrors: number;
      readonly numWarnings: number;
      readonly numInfos: number;
      readonly numHints: number;
      readonly messages: readonly ValidatorMessage[];
      readonly truncated: boolean;
    };
  }
  export function validateBytes(data: Uint8Array, options?: ValidationOptions): Promise<ValidatorReport>;
  export function version(): string;
}
