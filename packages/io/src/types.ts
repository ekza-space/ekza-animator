// Contract file: MVP-SPEC §4.4 with the M2A-SPEC §4.4, M6A-SPEC §4.5 and M6B-SPEC §4.4/§0.5 additions, copied verbatim (shapes are normative;
// change the spec first). The M6a functions and constants live in the lazy entries `io/mesh` and `io/write` (§4.5).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { Fps, Frame, ReadonlyXf } from '@ekza-studio/anim-core';
import type { AssetId, AssetRecord, CharacterId, CharacterVrmMeta, ClipId, ColourOutput, DerivedFrom, DocSnapshot,
  GeneratorProvenance, HandheldGrip, JointRecord, MeshId, Redistributable, RootMotionMode } from '@ekza-studio/doc';
import type { MeshData, SkinWeights } from '@ekza-studio/mesh-core';
import type { PoseBuffers, RigProgram, SkeletonDesc, TrackKey } from '@ekza-studio/rig';

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
export const BUILTIN_EXPORT_KINDS = ['bake-into-model', 'animation-glb', 'vrma', 'static-glb'] as const;   // changed (M6a)
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
  /** Node whose X/Z travel rootMotion 'in-place' removes (humanoid: hips; generic: topmost driven joint with
   *  translation); null makes 'in-place' unavailable. */
  readonly inPlaceNode: number | null;
  /** Fully stepped tracks → STEP sampler at these clip frames (rig.computeStepSchedule). Others: LINEAR. */
  readonly stepSchedule: ReadonlyMap<TrackKey, readonly Frame[]>;
  /** Tracks every clip of the output file must contain (constant tracks get 2 keys); see §4.11.10. */
  readonly requiredTracks: ReadonlySet<TrackKey>;
  readonly meta: EkzaClipMetaV1;
  /** M2a §5.16: export-side key reduction of the sampled tracks; absent or null = no reduction (M1 bytes). */
  readonly reduce?: { readonly spec: ExportReduceSpec; readonly height: number;
    readonly leverArm: ReadonlyMap<number, number>; readonly keep: ReadonlyMap<TrackKey, readonly Frame[]> } | null;
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
  /** M2a §5.16: present when the clip was reduced. */
  readonly reduction?: ReductionStats;
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
  /**
   * The clip's display label (CHARACTER-CONTRACT-SPEC §8.14, ADR 0010 rev. 3): written only when set (a package clip,
   * whose animation is named by its slot), so files without one keep their bytes (the M1 goldens).
   */
  readonly label?: string | null;
  /** Named marker times other than the contact (seconds from the clip's start); written only when not empty. */
  readonly markers?: Readonly<Record<string, number>>;
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
  readonly stats: { readonly clips: number; readonly channels: number; readonly keys: number; readonly bytesAppended?: number;
    /** M2a §5.16: sample counts and max errors of the export-side reduction. */
    readonly reduction?: ReductionStats };
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
  /** M2a §5.16: export-side key reduction; absent or null = no reduction, the M1 output byte for byte. */
  readonly reduce?: ExportReduceSpec | null;
}

// ---------- M2a: export reduction (M2A-SPEC §4.4) ----------

/** R02 §6.4 tolerances; position terms scale with the character height H (÷ 1.7 m). */
export interface ExportReduceSpec {
  readonly positionM: number;                  // ε_pos for a 1.7 m character; default 0.0002
  readonly rotationCapRad: number;             // θ_cap; default 0.25° = 0.004363323129985824
  readonly minLeverM: number;                  // L_min; default 0.01
  readonly scaleRel: number;                   // default 1e-4 (relative)
}
export const DEFAULT_EXPORT_REDUCE: ExportReduceSpec = {
  positionM: 0.0002, rotationCapRad: 0.004363323129985824, minLeverM: 0.01, scaleRel: 1e-4,
};

export interface ReductionStats {
  readonly samplesBefore: number;
  readonly samplesAfter: number;
  readonly maxRotationErrorRad: number;
  readonly maxTranslationErrorM: number;
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
  /** Every `blobs/<sha256>` entry, hash-verified; a corrupt or missing blob is absent here (its mesh goes `error`). */
  readonly blobs: ReadonlyMap<string, Uint8Array>;                                // changed (additive, M6a)
}

/** Placement of model scene under the canonical character root (viewport uses it). */
export interface ModelPlacement { readonly facing: ReadonlyXf }

// ---------- M6a (M6A-SPEC §4.5) ----------

// ---------- make editable (io/mesh, lazy) ----------
export interface MakeEditableReport {
  readonly triangles: number;
  readonly pointsBefore: number; readonly pointsAfter: number;   // glTF vertices → welded points
  readonly degenerateDropped: number;
  readonly hardEdges: number;
  readonly layers: readonly string[];                            // 'uv0', 'skin.joints', 'morph:Blink', …
  readonly morphNormals: readonly string[];                      // targets whose primitives carried NORMAL deltas
  readonly hadTangents: boolean;
  readonly warnings: readonly string[];
}
export type MakeEditableRefusal = { readonly refused: true; readonly code: 'licence' | 'too-large' | 'compressed' | 'unsupported'; readonly reason: string };

// ---------- primitives out (io/mesh; the writers below call them from io/write) ----------
export interface PaletteTexture {
  readonly png: Uint8Array;                    // ekza-palette-v1 (§5.19), deterministic bytes
  readonly width: number; readonly height: number;
  readonly cols: number; readonly rows: number;
  uvOf(slot: number): readonly [number, number];   // cell centre; v from the top (glTF)
}
export interface PrimitiveOut {
  readonly material: number;                   // slot index into the caller's material list
  readonly attributes: Readonly<Record<string, Float32Array | Uint16Array | Uint8Array>>;   // POSITION, NORMAL, TEXCOORD_0, COLOR_0, JOINTS_0, WEIGHTS_0
  readonly indices: Uint16Array | Uint32Array;
  readonly targets: readonly Readonly<Record<'POSITION' | 'NORMAL', Float32Array>>[];      // manifest morph order
}

// ---------- surgeon "replace primitives" and bake marker v2 (io/write) ----------
export interface PrimitiveEdit { readonly meshIndex: number; readonly data: MeshData; readonly morphNormals: ReadonlySet<string>;
  readonly hadTangents: boolean; readonly dropTangents: boolean }
/** asset.extras.ekza_animator_bake_v2 (written instead of v1 when a geometry step was applied). */
export interface EkzaBakeMarkerV2 {
  readonly version: 2;
  readonly baseAnimations: number; readonly baseAccessors: number; readonly baseBufferViews: number;
  readonly baseBinLength: number; readonly baseBinSha256: string; readonly baseSha256: string;
  readonly replaced: Readonly<Record<string, unknown>>;              // animations, as v1
  readonly replacedPrimitives: Readonly<Record<string, unknown>>;    // mesh index → original `primitives` JSON array
  readonly originalExtensions: { readonly used: readonly string[] | null; readonly required: readonly string[] | null } | null;
  readonly generatorAdded?: true;
}

// ---------- author writer for static models (io/write) ----------
export interface StaticNode {
  readonly id: string;                         // MeshId | GroupId
  readonly name: string;
  readonly placement: ReadonlyXf;              // TRS; scales must be positive and uniform (lint)
  readonly mesh: { readonly data: MeshData; readonly materials: readonly StaticMaterial[]; readonly colourOutput: ColourOutput;
    readonly paletteId: string | null } | null;
  readonly children: readonly StaticNode[];
}
export type StaticMaterial = { readonly preset: 'unlit' | 'lit'; readonly name: string };
/** A swatch's shader (SHADING-SPEC §4): Lambert or Blinn with its glossiness 0…1 and specular sRGB colour. */
export interface SwatchShading { readonly shader: 'lambert' | 'blinn'; readonly glossiness: number;
  readonly specular: readonly [number, number, number] }
/** A live swatch of an exported palette; `shader` absent = Lambert (SHADING-SPEC §4). */
export interface StaticSwatch { readonly slot: number; readonly srgb: readonly [number, number, number];
  readonly shader?: SwatchShading }
export interface StaticScene {
  readonly roots: readonly StaticNode[];
  readonly palettes: ReadonlyMap<string, readonly StaticSwatch[]>;
  readonly handheld: HandheldGrip | null;
  readonly model: EkzaModelV1;
}
/** asset.extras.ekza_model_v1 (research 14 §9.5, ADR 0017 §7); hashed with the bytes, no key named `uri`. */
export interface EkzaModelV1 {
  readonly schema: 1;
  readonly rig: 'none' | 'vrm-humanoid' | 'generic';
  readonly skeletonTemplate: string | null;
  readonly provenance: {
    readonly tool: 'ekza-animator'; readonly toolVersion: string; readonly projectSha256: string | null;
    readonly derivedFrom: readonly DerivedFrom[];
    readonly generator: { readonly kind: 'manual' } | ({ readonly kind: 'ai' } & Omit<GeneratorProvenance, 'kind' | 'taskId' | 'prompt'>
      & { readonly prompt?: string });
  };
}
/** `file.exportModel` request (§6.2). */
export interface StaticExportRequest {
  readonly objects: readonly string[];         // export roots (MeshId | GroupId); [] = selected objects, else every scene mesh
  readonly fileName: string;
  readonly profile: string | null;             // 'ekza/omoba-handheld-v1' | 'local/generic' | null
  readonly colourOutput?: ColourOutput;        // default: each mesh's own
  readonly materialPreset?: 'unlit' | 'lit';   // default: each mesh's own
  readonly dropTangents?: boolean;             // default false (§5.21)
  readonly validate?: boolean;                 // default true: lazy glTF-Validator
}
// The shipped 'local/generic' profile (kind '*') also applies to static exports: generic lints only.


// =====================================================================================================================
// M6b (M6B-SPEC §4.4): skinned measurement, character writer, profiles, lints (C0 stubs; owners C1, C10, C11), and the
// §0.5 clip library (C12). `function`/`const` lines are implementation modules re-exported from the root.
// =====================================================================================================================

// ---------- character writer (C1 minimal; C10 full; §5.22) ----------
export interface CharacterMeshIn {
  readonly id: MeshId; readonly name: string;
  readonly data: MeshData;                                   // identity placement, character space
  readonly skin: SkinWeights | null;                         // null = static mesh parented to the root
  readonly materials: readonly { readonly preset: 'unlit' | 'lit'; readonly name: string }[];
  readonly colourOutput: ColourOutput; readonly paletteId: string | null;
  readonly prop: boolean;                                    // bound only to prop joints
  /** The adopted asset material of each face-material slot (C1 keeps an import's materials as asset slots; AUTORIG
   *  §6.1, AR-D7-15): the writer copies them, image texture included, onto a mesh without a palette. Absent or empty:
   *  the palette / preset materials only. */
  readonly assetMaterials?: readonly (CharacterAssetMaterial | null)[];
}
/** An asset material as the character writer copies it (`characterAssetMaterials` reads it from the asset GLB). */
export interface CharacterAssetMaterial {
  readonly name: string;
  readonly baseColorFactor: readonly [number, number, number, number];
  readonly baseColorTexture: {
    /** Identifies the image within the export (the same key writes one image). */
    readonly key: string;
    readonly image: Uint8Array; readonly mimeType: string;
    readonly texCoord: number;
    readonly sampler: { readonly magFilter: number | null; readonly minFilter: number | null;
      readonly wrapS: number; readonly wrapT: number };
  } | null;
  readonly alphaMode: 'OPAQUE' | 'MASK' | 'BLEND'; readonly alphaCutoff: number | null;
  readonly doubleSided: boolean;
}
export interface CharacterWriteInput {
  readonly skeleton: SkeletonDesc;                           // skeletonFromDoc; node i = written joint node i
  readonly joints: readonly JointRecord[];                   // names, roles
  readonly meshes: readonly CharacterMeshIn[];
  readonly palettes: ReadonlyMap<string, readonly { readonly slot: number; readonly srgb: readonly [number, number, number] }[]>;
  readonly clips: readonly { readonly name: string; readonly fps: number; readonly loop: boolean;
    readonly tracks: readonly RawTrackOut[] }[];             // sampled by editor-core through the kernel (ADR 0005)
  readonly vrm: CharacterVrmMeta | null;                     // null → plain GLB (no VRMC_vrm)
  readonly thumbnailPng: Uint8Array | null;
  readonly model: EkzaModelV1;
  readonly heightScale: number | null;                       // extras.ekza.avatar.heightScale when set
}
export interface RawTrackOut { readonly node: number; readonly path: 'translation' | 'rotation' | 'scale';
  readonly times: Float32Array; readonly values: Float32Array; readonly interpolation: 'LINEAR' | 'STEP' }

/** `file.exportCharacter` request (§6.4). */
export interface CharacterExportRequest {
  readonly character: string;                                // CharacterId (model-sourced; asset characters use the shipped bake path)
  readonly fileName: string;
  readonly format: 'vrm' | 'glb';
  readonly profile: string | null;                           // 'ekza/space-avatar-v1' | 'ekza/omoba-humanoid-v1' | 'local/generic' | null
  // 'slots' = every clip with an Ekza slot name; 'target' (CHARACTER-CONTRACT-SPEC §8.10, C2) = the custom clips of the
  // character's contract target, each named by its primary slot, with the `ekza_package_v1` slot map
  readonly clips: readonly ClipId[] | 'slots' | 'target';
  readonly includeProps: boolean | null;                     // null = the profile's default (§5.22)
  readonly material: 'unlit' | 'lit' | null;                 // null = each mesh's own
  readonly thumbnail: 'stored' | 'none';                     // vrm: 'stored' (required by the profile lints)
  readonly validate: boolean;                                // glTF-Validator (lazy) + the read-back
}

// ---------- io (C12): library (§0.5) ----------
export interface StarterPackClip {
  readonly id: string;                       // file stem, [a-z0-9-]+
  readonly source: string;                   // UAL clip name, e.g. 'Walk_Loop'
  readonly label: string; readonly slot: string | null; readonly loop: boolean;
  readonly file: string;                     // '<id>.vrma'
  readonly bytes: number; readonly sha256: string;
  readonly duration: number; readonly fps: 30;
  readonly license: 'CC0-1.0'; readonly credit: 'Quaternius';
}
export interface StarterPackManifest {
  readonly version: 1; readonly id: 'ekza/starter-pack';
  readonly title: string;                    // 'Starter pack — Universal Animation Library'
  readonly license: 'CC0-1.0';
  readonly credit: string;                   // 'Universal Animation Library by Quaternius (CC0)'
  readonly sourceUrl: string;                // https://quaternius.com/packs/universalanimationlibrary.html
  readonly source: { readonly file: string; readonly sha256: string };   // the fixture
  readonly generator: string;                // 'tooling/make-starter-pack.mjs v1'
  readonly clips: readonly StarterPackClip[];
}
