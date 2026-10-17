// Contract file: MVP-SPEC §4.4, copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { Fps, Frame, ReadonlyXf } from '@ekza-animator/anim-core';
import type { AssetId, AssetRecord, CharacterId, ClipId, DerivedFrom, DocSnapshot, Redistributable,
  RootMotionMode } from '@ekza-animator/doc';
import type { PoseBuffers, RigProgram, TrackKey } from '@ekza-animator/rig';

/** Loosely typed glTF JSON; typed accessors live in io/src/gltf/schema.ts. */
export interface GltfJson {
  readonly asset: { readonly version: string; readonly generator?: string; readonly extras?: Readonly<Record<string, unknown>> };
  readonly [key: string]: unknown;
}

export interface GlbContainer {
  readonly bytes: Uint8Array;                  // the original file, never mutated
  readonly json: GltfJson;                     // parsed JSON chunk (treat as immutable)
  readonly jsonByteLength: number;
  readonly bin: Uint8Array | null;             // view of the BIN chunk data (no copy), padding included
  readonly sha256: string;                     // lowercase hex of bytes
}

/** Pre-allocation budgets for untrusted input (ARCHITECTURE §16). "count" = accessor.count. */
export interface InputBudget {
  readonly maxFileBytes: number;
  readonly maxJsonBytes: number;
  readonly maxTotalAccessorCount: number;      // Σ accessor.count over all accessors (sparse included)
  readonly maxAccessorCount: number;           // any single accessor.count
  readonly maxDecodedBytes: number;            // Σ count × element size
  readonly maxNodes: number;
}
export const DEFAULT_INPUT_BUDGET: InputBudget = {
  maxFileBytes: 268_435_456,                   // 256 MiB
  maxJsonBytes: 8_388_608,                     // 8 MiB
  maxTotalAccessorCount: 16_000_000,
  maxAccessorCount: 4_000_000,
  maxDecodedBytes: 536_870_912,                // 512 MiB
  maxNodes: 65_536,
};

/** Open string; built-ins are registered by editor-core as exporters (§4.5). */
export type ExportKind = string;
export const BUILTIN_EXPORT_KINDS = ['bake-into-model', 'animation-glb', 'vrma'] as const;
export type BuiltinExportKind = (typeof BUILTIN_EXPORT_KINDS)[number];

/** Evaluation callback so io never depends on editor state. `frame` is a clip frame. */
export interface PoseSource {
  readonly program: RigProgram;
  evaluate(frame: Frame, out: PoseBuffers): void;
}

export interface BakeOptions {
  readonly name: string;                       // exported glTF animation name (slot or sanitized clip name)
  readonly fps: Fps;
  readonly range: { readonly start: Frame; readonly end: Frame };   // integer clip frames, inclusive
  readonly target: 'raw' | 'humanoid';         // raw node locals (GLB/VRM) or normalized N_b (VRMA)
  readonly closeLoop: boolean;
  readonly loop: boolean;
  readonly rootMotion: RootMotionMode;
  /** Node whose X/Z is locked for rootMotion 'in-place' (humanoid: hips; generic: topmost driven joint with
   *  translation); null makes 'in-place' unavailable. */
  readonly inPlaceNode: number | null;
  /** Fully stepped tracks → STEP sampler at these clip frames (rig.computeStepSchedule). Others: LINEAR. */
  readonly stepSchedule: ReadonlyMap<TrackKey, readonly Frame[]>;
  /** Tracks every clip of the output file must contain (constant tracks get 2 keys); see §4.11.10. */
  readonly requiredTracks: ReadonlySet<TrackKey>;
  readonly meta: EkzaClipMetaV1;
}

export interface BakedTrack {
  readonly node: number;                       // raw: SkeletonDesc node index; humanoid: index into HUMAN_BONE_NAMES
  readonly path: 'translation' | 'rotation' | 'scale';
  readonly interpolation: 'LINEAR' | 'STEP';
  readonly times: Float32Array;                // seconds, starts at 0, strictly increasing after fround
  readonly values: Float32Array;               // xyz or xyzw; quaternions unit + hemisphere-continuous
}

export interface BakedClip {
  readonly name: string;
  readonly target: 'raw' | 'humanoid';
  readonly fps: Fps;
  readonly frameCount: number;
  readonly duration: number;                   // seconds
  readonly tracks: readonly BakedTrack[];
  readonly restHipsPosition: readonly [number, number, number] | null;   // humanoid target
  readonly meta: EkzaClipMetaV1;
  readonly warnings: readonly LintIssue[];     // e.g. bake.large-rotation-step
}

/** Per-clip metadata inside asset.extras.ekza_animation_v1 (ADR 0010). */
export interface EkzaClipMetaV1 {
  readonly index: number;
  readonly name: string;
  readonly slot: string | null;
  readonly loop: boolean;
  readonly fps: number;                        // num/den as a number
  readonly durationSeconds: number;
  readonly rootMotion: RootMotionMode;
  readonly contactSeconds: number | null;
  readonly tags: readonly string[];
  readonly derivedFrom: readonly DerivedFrom[];
  readonly redistributable: Redistributable;
}
export interface EkzaAnimationV1 {
  readonly schema: 1;
  readonly rig: 'vrm-humanoid' | 'gltf-nodes';
  readonly clips: readonly EkzaClipMetaV1[];
  readonly provenance: {
    readonly tool: 'ekza-animator';
    readonly toolVersion: string;
    readonly projectSha256: string | null;
    readonly baseSha256: string | null;
    readonly derivedFrom: readonly DerivedFrom[];   // union of the clips' derivedFrom, deduplicated
  };
}
/** asset.extras.ekza_animator_bake_v1 (surgeon outputs only; §4.11.11). */
export interface EkzaBakeMarkerV1 {
  readonly baseAnimations: number;
  readonly baseAccessors: number;
  readonly baseBufferViews: number;
  readonly baseBinLength: number;              // original buffers[0].byteLength (0 if no buffer)
  readonly baseBinSha256: string;              // sha256(BIN[0, baseBinLength)) — the rollback check
  readonly baseSha256: string;                 // sha256 of the pre-bake file — provenance only
  /** Original JSON of every pre-baseline animation replaced in place, keyed by its index; written once. */
  readonly replaced: Readonly<Record<string, unknown>>;
  /** Present (true) only when the pre-bake file had no `asset.generator`: the surgeon wrote its own, and a
   *  rollback removes it again (WP-4 addition, docs/wp-notes/wp-4.md). */
  readonly generatorAdded?: true;
}

export type LintSeverity = 'error' | 'warning' | 'info';
export interface LintIssue {
  /** Registry issue code where one exists (e.g. 'rendition_external_data'), else a namespaced code
   *  ('ekza.json-chunk-size', 'vrma.non-hips-translation', 'surgeon.matrix-node'); table in ADR 0010. */
  readonly code: string;
  readonly severity: LintSeverity;
  readonly message: string;
  readonly pointer?: string;                   // JSON pointer into the glTF
}
export interface ReadBackReport {
  readonly ok: boolean;
  readonly animations: number;
  readonly channels: number;
  readonly maxRotationErrorRad: number;
  readonly maxTranslationErrorM: number;
}
export interface ValidationIssue { readonly code: string; readonly severity: 0 | 1 | 2 | 3; readonly message: string; readonly pointer?: string }
export interface ValidationReport {
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
  readonly issues: readonly ValidationIssue[];
}

export interface ExportArtifact {
  readonly kind: ExportKind;
  readonly fileName: string;
  readonly mime: 'model/gltf-binary';
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly lints: readonly LintIssue[];
  readonly readBack: ReadBackReport | null;
  readonly validation: ValidationReport | null;   // tests and (stretch) the in-app worker
  readonly stats: { readonly clips: number; readonly channels: number; readonly keys: number; readonly bytesAppended?: number };
}

export interface ExportRequest {
  readonly kind: ExportKind;
  readonly character: CharacterId;
  readonly clips: readonly ClipId[];           // vrma: one artifact per clip
  readonly fileNamePattern: string;            // tokens {character} {clip} {fps}; e.g. '{character}_{clip}'
  readonly closeLoop: boolean;
  readonly includeConstantTracks: boolean;     // default true (ADR 0005 §3)
  readonly acknowledgeLicense: boolean;        // required when VRM meta forbids modification/redistribution
  readonly profile: string | null;             // ExportProfileDef id; null = generic lints only
}

/** Export target profile as data (mirrors the registry's GET /v1/profiles/{platform}/{profile}; ADR 0010). */
export interface ExportProfileDef {
  readonly id: string;                         // e.g. 'ekza/space-avatar-v1', 'ekza/vrma-humanoid-v1'
  readonly label: string;
  readonly platform: string;                   // registry platform, e.g. 'universal'
  readonly profile: string;                    // registry profile, e.g. 'vrm-humanoid-v1'
  readonly kind: ExportKind;
  readonly maxBytes: number;
  readonly jsonMaxBytes: number;
  readonly requiredClips?: readonly string[];
  readonly ekza: boolean;                      // Ekza target: slot-name and provenance lints become errors
  /** Lint rules with severity overrides (rule ids from the lint table in ADR 0010). */
  readonly rules: readonly { readonly id: string; readonly severity: LintSeverity }[];
}

export interface VrmLicenseInfo {
  readonly title: string | null;
  readonly authors: readonly string[];
  readonly licenseUrl: string | null;
  readonly allowRedistribution: boolean | null;
  readonly modification: 'prohibited' | 'allowModification' | 'allowModificationRedistribution' | null;
  readonly commercialUsage: string | null;
  readonly creditNotation: 'required' | 'unnecessary' | null;
  readonly licenseName: string | null;         // SPDX-like name used for DerivedFrom.license
}

export interface ProjectArchive {
  readonly snapshot: DocSnapshot;              // migrated
  readonly assets: ReadonlyMap<AssetId, { readonly record: AssetRecord; readonly bytes: Uint8Array }>;
  readonly readOnly: boolean;                  // minWriterVersion > SCHEMA_VERSION, or a newer table version
  readonly migratedFrom: number;
}

/** Placement of model scene under the canonical character root (viewport uses it). */
export interface ModelPlacement { readonly facing: ReadonlyXf }
