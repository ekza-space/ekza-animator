// Contract file: MVP-SPEC §4.1, copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
export class EkzaError extends Error {
  readonly code: string;
  readonly details: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'EkzaError';
    this.code = code;
    this.details = details;
  }
}
