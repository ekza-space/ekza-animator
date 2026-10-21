// Contract file: MVP-SPEC §4.2 with the M2A-SPEC §4.2, M6A-SPEC §4.2 and M6B-SPEC §4.1 (schema v4) additions, copied verbatim (shapes are normative;
// change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { AnimCurve, ControlShapeKind, Fps, Frame, InfinityMode, JsonValue, KeyData, ReadonlyQuat,
  ReadonlyVec3, ReadonlyXf, RotateOrder, SplineSet } from '@ekza-studio/anim-core';
import type { AssetId, CameraId, CharacterId, ClipId, ConstraintId, ControlId, CurveId, GroupId, ImagePlaneId, JointId,
  KeyId, LayerId, MeshId, PaletteId, RigId, SkeletonId, SolverId, SwatchId, UserId } from './ids';

/** Soft-delete marker for structural records (research 06 R4). `at` = ms since epoch. */
export type Tombstone = { readonly by: UserId; readonly at: number } | null;

export type ChannelId = 'tx' | 'ty' | 'tz' | 'rx' | 'ry' | 'rz' | 'sx' | 'sy' | 'sz' | `@${string}`;
export const TRS_CHANNELS = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const;
export type TrsChannel = (typeof TRS_CHANNELS)[number];
export type ChannelValues = Partial<Record<ChannelId, number>>;

export type Side = 'L' | 'R' | 'C';
export type Axes = readonly [boolean, boolean, boolean];
export type ModelFormat = 'vrm0' | 'vrm1' | 'gltf';

/** VRM 1.0 humanoid bone names (55). Order defines the `humanLocal` buffer layout (rig HUMAN_BONE_NAMES). */
export type HumanBoneName =
  | 'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head' | 'leftEye' | 'rightEye' | 'jaw'
  | 'leftUpperLeg' | 'leftLowerLeg' | 'leftFoot' | 'leftToes'
  | 'rightUpperLeg' | 'rightLowerLeg' | 'rightFoot' | 'rightToes'
  | 'leftShoulder' | 'leftUpperArm' | 'leftLowerArm' | 'leftHand'
  | 'rightShoulder' | 'rightUpperArm' | 'rightLowerArm' | 'rightHand'
  | 'leftThumbMetacarpal' | 'leftThumbProximal' | 'leftThumbDistal'
  | 'leftIndexProximal' | 'leftIndexIntermediate' | 'leftIndexDistal'
  | 'leftMiddleProximal' | 'leftMiddleIntermediate' | 'leftMiddleDistal'
  | 'leftRingProximal' | 'leftRingIntermediate' | 'leftRingDistal'
  | 'leftLittleProximal' | 'leftLittleIntermediate' | 'leftLittleDistal'
  | 'rightThumbMetacarpal' | 'rightThumbProximal' | 'rightThumbDistal'
  | 'rightIndexProximal' | 'rightIndexIntermediate' | 'rightIndexDistal'
  | 'rightMiddleProximal' | 'rightMiddleIntermediate' | 'rightMiddleDistal'
  | 'rightRingProximal' | 'rightRingIntermediate' | 'rightRingDistal'
  | 'rightLittleProximal' | 'rightLittleIntermediate' | 'rightLittleDistal';

/** Semantic bone reference; never a glTF node index (indices change on re-export). */
export type BoneRef =
  | { readonly humanoid: HumanBoneName }
  | { readonly name: string; readonly parentName: string | null; readonly occurrence?: number };

export interface ProjectRecord {
  readonly id: 'project';
  readonly name: string;
  readonly schemaVersion: number;              // core format version that last wrote the project (SCHEMA_VERSION)
  readonly minWriterVersion: number;           // apps whose SCHEMA_VERSION is lower open the project read-only (research 06 R11)
  readonly sceneFps: Fps;                      // scene clock rate and default fps of new clips; {num: 30, den: 1}
  readonly sceneRange: { readonly start: Frame; readonly end: Frame };   // scene frames; default 0..60
  readonly units: 'm';
  readonly upAxis: 'Y';
}

// ---------- changed (M6A-SPEC §4.2) ----------
export interface AssetRecord {
  readonly id: AssetId;                        // sha256 hex
  readonly name: string;                       // original file name
  readonly ext: 'glb' | 'vrm' | 'vrma' | 'png' | 'jpg';                          // changed: + png, jpg (image planes; archived under `images/`, §5.20)
  readonly mime: 'model/gltf-binary' | 'image/png' | 'image/jpeg';               // changed
  readonly size: number;
  readonly role: 'model' | 'animation-source' | 'reference-image' | 'thumbnail';   // changed: + reference-image; M6b v4: + thumbnail
                                                                                   // (png/jpg, square; archived under images/, M6A §5.20)
  /** v3 (ADR 0017 §7): null for assets imported before v3 and for plain imports; set by M7 generation. */
  readonly provenance: AssetProvenance | null;
}
export interface AssetProvenance {
  readonly origin: 'imported' | 'generated' | 'authored';
  readonly derivedFrom: readonly DerivedFrom[];
  readonly redistributable: Redistributable;
  readonly generator: GeneratorProvenance | null;
}
/** Filled by M7; M6a only stores, validates, exports and lints it. */
export interface GeneratorProvenance {
  readonly kind: 'ai';
  readonly digitalSourceType: string;          // IPTC, e.g. 'trainedAlgorithmicMedia'
  readonly service: string;                    // 'tripo' | 'meshy' | 'selfhost' | …
  readonly model: string;                      // pinned model version; never 'latest'
  readonly op: string;                         // 'image-to-3d' | 'text-to-3d' | 'rig' | …
  readonly params: Readonly<Record<string, JsonValue>>;
  readonly inputSha256: readonly string[];
  readonly termsSnapshot: Readonly<Record<string, JsonValue>> | null;
  readonly rawSha256: string;
  readonly postSteps: readonly { readonly op: string; readonly aiMarksMayBeAltered: boolean }[];
  readonly promptSha256: string | null;
  readonly prompt: string | null;              // only on the user's opt-in (Q-GEN-5)
  readonly tier: 'paid' | 'free' | 'unknown';  // the user's attestation (Q-GEN-9)
  readonly taskId: string | null;              // provider task id; document only, never exported
}
export type CharacterSource =
  | { readonly kind: 'asset'; readonly asset: AssetId }
  | { readonly kind: 'model'; readonly skeleton: SkeletonId };                  // M6b

export interface CharacterRecord {
  readonly id: CharacterId;
  readonly name: string;
  /** v3: kept so that projects without v3-only content stay usable by M2a apps (minWriterVersion 2). Equals
   *  `source.asset` for asset-sourced characters; null exactly when `source.kind === 'model'` (M6b). */
  readonly asset: AssetId | null;                                                // changed: nullable
  readonly source: CharacterSource;                                              // v3
  readonly format: ModelFormat;
  readonly rig: RigId;
  readonly placement: ReadonlyXf;              // scene placement of the character root (MVP: offset along X per character)
  readonly order: string;                      // fractional index
  readonly deleted: Tombstone;
  /** v4: VRM meta of a model-sourced character's exports (§5.22); null until the user sets it; ignored for
   *  asset-sourced characters (their VRM meta is the asset's). */
  readonly vrm: CharacterVrmMeta | null;
}

// ---------- M6b schema v4 (M6B-SPEC §4.1): new ----------
export type VrmLicensePreset = 'cc0' | 'cc-by-4.0' | 'personal' | 'custom';
/** VRMC_vrm 1.0 meta (schema defaults in comments) plus the editor's licence preset and thumbnail. */
export interface CharacterVrmMeta {
  readonly name: string;                                   // required; default: the character name
  readonly version: string;                                // '' = omitted
  readonly authors: readonly string[];                     // required, ≥ 1 non-empty entry at export (no default)
  readonly copyrightInformation: string;                   // '' = omitted
  readonly contactInformation: string;                     // '' = omitted
  readonly references: readonly string[];
  readonly licensePreset: VrmLicensePreset | null;         // null = not chosen: export blocked (Q-SKIN-3)
  readonly avatarPermission: 'onlyAuthor' | 'onlySeparatelyLicensedPerson' | 'everyone';          // onlyAuthor
  readonly commercialUsage: 'personalNonProfit' | 'personalProfit' | 'corporation';                // personalNonProfit
  readonly creditNotation: 'required' | 'unnecessary';                                             // required
  readonly allowRedistribution: boolean;                                                          // false
  readonly modification: 'prohibited' | 'allowModification' | 'allowModificationRedistribution';   // prohibited
  readonly allowExcessivelyViolentUsage: boolean;                                                 // false
  readonly allowExcessivelySexualUsage: boolean;                                                  // false
  readonly allowPoliticalOrReligiousUsage: boolean;                                               // false
  readonly allowAntisocialOrHateUsage: boolean;                                                   // false
  readonly otherLicenseUrl: string;                        // '' = omitted; the CC presets fill the deed URL
  readonly thirdPartyLicenses: string;                     // '' = filled from provenance at export (§5.22)
  readonly thumbnail: AssetId | null;                      // AssetRecord role 'thumbnail'
}

export interface RigRecord {
  readonly id: RigId;
  readonly character: CharacterId;
  readonly format: 'ekza.rig';
  readonly version: 1;
  readonly generator: { readonly name: 'ekza-autorig-humanoid' | 'ekza-autorig-generic'; readonly version: string };
  readonly skeleton: {
    readonly format: ModelFormat;
    readonly fingerprint: string;              // 'sha256:<hex>' of sorted names/parents/rest TRS (1e-5)
    readonly facing: ReadonlyQuat;             // model → canonical character space; VRM 0.x: [0, 1, 0, 0]
  };
  readonly deleted: Tombstone;
}

export interface ControlShape {
  readonly kind: ControlShapeKind;
  readonly size: number;                       // metres (radius / half-extent)
  readonly offset: ReadonlyXf;                 // shape placement in control-local space (orientation, slide down the bone)
  readonly custom: SplineSet | null;           // kind === 'custom' only
  readonly color: 'side' | `#${string}`;
  readonly lineWidth: number | null;           // px; null = theme default (2)
  readonly edited?: readonly ShapeField[];    // M6b v4, optional: absent = generated; 'kind' also covers the custom points
}
/** M6b v4: shape fields a user edited; `rig.autoRig.update` keeps them (§5.20). */
export type ShapeField = 'kind' | 'size' | 'offset' | 'color' | 'lineWidth';

export interface Binding {
  readonly bone: BoneRef;
  readonly mode: 'rotate' | 'translateRotate' | 'full';
}

export interface AttrDef {
  readonly type: 'float' | 'bool' | 'enum';
  readonly default: number;
  readonly min?: number;
  readonly max?: number;
  readonly enumLabels?: readonly string[];
  readonly keyable: boolean;
  /** M2a: new keys on this attribute get in 'flat', out 'step' (MVP: stored, unused). */
  readonly stepped?: boolean;
  /** M2a: Channel Box and Graph Editor label; default: the name title-cased ('heelTwist' → 'Heel Twist'). */
  readonly label?: string;
  /** M2a: stored radians or metres, shown in degrees or metres; absent = a plain number (3 decimals). */
  readonly unit?: 'angle' | 'distance';
  /** M2a: how pose and animation mirroring map the value (§5.14); default 'copy'. */
  readonly mirror?: 'copy' | 'negate';
  /**
   * M2a: false = a mode or setting, keyed and reset only when named explicitly (§5.1 rule 4): `S` with 'all' or
   * 'attributes', body-part keying, the tween 'frame' target, the pose clipboard and `pose.resetToRest` skip it unless
   * it is a selected Channel Box channel. Default true.
   */
  readonly keyAll?: boolean;
}

export interface ControlRecord {
  readonly id: ControlId;
  readonly rig: RigId;
  readonly key: string;                        // template key, e.g. 'fk.upperArm.L', 'cog', 'fk.hips', 'sec.hat'
  readonly name: string;                       // display name, e.g. 'L Upper Arm'
  readonly side: Side;
  readonly group: 'body' | 'fingers' | 'face' | 'secondary';
  readonly parent: ControlId | null;           // default space; null = character root
  readonly order: string;                      // fractional index among siblings
  readonly restWorld: ReadonlyXf;              // W_c⁰ in canonical character space
  readonly rotateOrder: RotateOrder;
  readonly keyable: { readonly t: Axes; readonly r: Axes; readonly s: Axes };
  readonly locked: { readonly t: Axes; readonly r: Axes; readonly s: Axes };
  readonly drives: Binding | null;             // null: pure space control (root, cog)
  readonly mirror: ControlId | null;           // counterpart; null for side 'C' and for unpaired L/R controls
  readonly attrs: Readonly<Record<string, AttrDef>>;   // custom keyable attributes, channel '@name' (M2a: IK controls)
  readonly shape: ControlShape;
  readonly hiddenByDefault: boolean;           // secondary controls: true
  readonly deleted: Tombstone;
}

export type SpaceTarget =
  | { readonly kind: 'world' }
  | { readonly kind: 'control'; readonly id: ControlId }
  | { readonly kind: 'bone'; readonly bone: BoneRef };

/** Schema slot (research 07 §19.1). MVP compiles these to disabled ops. */
export interface ConstraintRecord {
  readonly id: ConstraintId;
  readonly rig: RigId;
  readonly type: 'parent' | 'point' | 'orient' | 'aim';
  readonly driven: { readonly control: ControlId } | { readonly bone: BoneRef };
  readonly targets: Readonly<Record<string, { readonly target: SpaceTarget; readonly weight: number; readonly offset?: ReadonlyXf }>>;
  readonly maintainOffset: boolean;
  readonly params: Readonly<Record<string, unknown>>;   // aim settings, skip axes, blend (typed in V1)
  readonly enabled: boolean;
  readonly deleted: Tombstone;
}

/** Schema slot for IK/foot roll/chains (research 07 §19.1). MVP compiles these to disabled ops. */
export interface SolverRecord {
  readonly id: SolverId;
  readonly rig: RigId;
  readonly type: 'ik2' | 'footRoll' | 'chain';
  readonly params: Readonly<Record<string, unknown>>;
  readonly enabled: boolean;
  readonly deleted: Tombstone;
}

export interface CameraRecord {
  readonly id: CameraId;
  readonly name: string;                       // 'shotCam'
  readonly projection: 'perspective' | 'orthographic';
  readonly fovY: number;                       // radians (perspective)
  readonly orthoHeight: number;                // metres (orthographic)
  readonly near: number;
  readonly far: number;
  readonly transform: ReadonlyXf;              // world; s = [1,1,1]
  readonly target: readonly [number, number, number];   // orbit pivot (camera-controls target)
  readonly aspect: number | null;              // safe-frame aspect (w/h); null = pane aspect
  readonly locked: boolean;                    // document-level lock: no pane may navigate it
  readonly order: string;
  readonly deleted: Tombstone;
}

export type RootMotionMode = 'hips' | 'in-place';

export type ClipSource =
  | { readonly kind: 'new' }
  | { readonly kind: 'embedded'; readonly asset: AssetId; readonly animationIndex: number; readonly animationName: string }
  | { readonly kind: 'imported'; readonly fileName: string; readonly asset: AssetId | null }
  | { readonly kind: 'test'; readonly generator: 'rom'; readonly version: 1 };     // M6b v4: generated test clip; never exported

export type Redistributable = 'yes' | 'no' | 'unknown';
export interface DerivedFrom {
  readonly title: string;
  readonly author: string;
  /** SPDX identifier (e.g. 'CC0-1.0'), 'LicenseRef-VRM-PL-1.0', 'unknown' or 'proprietary'. */
  readonly license: string;
  readonly sourceSha256: string | null;
}
export interface ClipProvenance {
  readonly derivedFrom: readonly DerivedFrom[];   // empty for clips authored from scratch
  readonly redistributable: Redistributable;      // 'yes' for clips authored from scratch
}

export interface ClipRecord {
  readonly id: ClipId;
  readonly character: CharacterId;
  readonly name: string;                       // display name, ≤ 64 chars, [A-Za-z0-9 _.-]
  readonly slot: string | null;                // Ekza slot vocabulary v1 (ADR 0010) or null
  readonly fps: Fps;
  readonly range: { readonly start: Frame; readonly end: Frame };   // clip frames, integers, start < end
  readonly sceneStart: Frame;                  // scene frame at which clip frame 0 plays (default 0)
  readonly loop: boolean;
  readonly rootMotion: RootMotionMode;
  readonly contact: Frame | null;              // impact pose (attack/cast), clip frames; exported as contactSeconds
  readonly tags: readonly string[];            // lowercase [a-z0-9_-], ≤ 8 tags
  readonly provenance: ClipProvenance;
  readonly source: ClipSource;
  readonly order: string;
  readonly deleted: Tombstone;
}

export interface LayerRecord {
  readonly id: LayerId;
  readonly clip: ClipId;
  readonly name: string;                       // 'Base'
  readonly mode: 'override' | 'additive';
  readonly weight: number;
  readonly mute: boolean;
  readonly solo: boolean;
  readonly owner: UserId | null;               // P3 per-user layers ("four hands"); null in the MVP
  readonly order: string;                      // base layer = lowest
  readonly deleted: Tombstone;
}

export interface CurveRecord {
  readonly id: CurveId;
  readonly clip: ClipId;
  readonly layer: LayerId;
  readonly control: ControlId;
  readonly channel: ChannelId;
  readonly weighted: boolean;
  readonly pre: InfinityMode;
  readonly post: InfinityMode;
  /** Maya "static attribute value": used when the curve has no keys. null = channel default. */
  readonly staticValue: number | null;
  readonly locked: boolean;                    // Graph Editor lock (no edits)
  readonly muted: boolean;                     // V1 (evaluator ignores in MVP)
  readonly deleted: Tombstone;
}

export interface KeyRecord extends KeyData {
  readonly id: KeyId;
  readonly clip: ClipId;
  readonly curve: CurveId;
}

/** Built-in tables. Extensions add tables by declaration merging plus a runtime `TableDef` (§4.11.0). */
export interface Tables {
  project: ProjectRecord;
  assets: AssetRecord;
  characters: CharacterRecord;
  rigs: RigRecord;
  controls: ControlRecord;
  constraints: ConstraintRecord;
  solvers: SolverRecord;
  cameras: CameraRecord;
  clips: ClipRecord;
  layers: LayerRecord;
  curves: CurveRecord;
  keys: KeyRecord;
  // M6a (M6A-SPEC §4.2), changed: the seven modeling tables
  meshes: MeshRecord; groups: GroupRecord; palettes: PaletteRecord;
  swatches: SwatchRecord; imagePlanes: ImagePlaneRecord; skeletons: SkeletonRecord; joints: JointRecord;
}
export type TableName = keyof Tables;
export type RecordOf<T extends TableName> = Tables[T];
export type IdOf<T extends TableName> = Tables[T]['id'];
export type AnyRecord = Tables[TableName];
export type SoftDeletableTable = Exclude<TableName, 'project' | 'assets' | 'keys'>;
export const BUILTIN_TABLES = [
  'project', 'assets', 'characters', 'rigs', 'controls', 'constraints', 'solvers', 'cameras', 'clips', 'layers',
  'curves', 'keys', 'meshes', 'groups', 'palettes', 'swatches', 'imagePlanes', 'skeletons',
  'joints' ] as const;                                                          // changed (appended, order fixed)
export type BuiltinTableName = (typeof BUILTIN_TABLES)[number];

/** CRDT document boundary (ADR 0002): scene | char:<CharacterId> | clip:<ClipId>. */
export type Partition = 'scene' | `char:${string}` | `clip:${string}`;

/** Unit of last-writer-wins merge and of compare-before-restore undo (research 06 R3). */
export type MergeUnit = 'record' | 'field';
export const MERGE_UNIT: Readonly<Record<BuiltinTableName, MergeUnit>> = {
  project: 'field', assets: 'record', characters: 'field', rigs: 'field', controls: 'field',
  constraints: 'field', solvers: 'field', cameras: 'field', clips: 'field', layers: 'field', curves: 'field',
  keys: 'record', meshes: 'field', groups: 'field', palettes: 'field', swatches: 'field',
  imagePlanes: 'field', skeletons: 'field', joints: 'field',
};                                                                              // changed (M6a)

/** WP-2 addition (docs/wp-notes/wp-2.md): resolves what a record alone cannot tell — rig-scoped records (controls,
 *  constraints, solvers) reference only their rig, and their partition is `char:<the rig's character>`. Stores pass
 *  a lookup over their own state; an unknown rig yields `undefined` (the record then belongs to `scene`). */
export interface PartitionLookup {
  rigCharacter(rig: RigId): CharacterId | undefined;
  skeletonCharacter(skeleton: SkeletonId): CharacterId | undefined;            // additive (M6a)
}

/** Runtime description of a table: built-ins are registered by `doc`, extensions call registerTable(). */
export interface TableDef {
  readonly name: string;                       // built-ins unprefixed; extensions namespaced 'vendor.table'
  readonly version: number;                    // per-table schema version (DocSnapshot.tableVersions)
  readonly mergeUnit: MergeUnit;               // nested objects (shape, keyable, range, placement, …) are atomic values
  readonly softDelete: boolean;
  /** `lookup` (WP-2 addition) is passed by stores; the built-in rig-scoped tables require it. */
  partition(record: { readonly id: string }, lookup?: PartitionLookup): Partition;
  /** [] when valid; otherwise human-readable problems. */
  validate(record: unknown): readonly string[];
  /** Pure, idempotent migrations; index i migrates version i+1 → i+2. New IDs derive as hash(oldId + ':' + purpose). */
  readonly migrations: readonly ((record: unknown) => unknown)[];
}

// ---------- M6a new tables (M6A-SPEC §4.2) ----------
export type MeshOwner = { readonly character: CharacterId } | { readonly scene: true };
export type PrimitiveKind = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'torus' | 'humanoidBody';
/** One field value = one merge unit (ADR 0015 §1). */
export interface MeshRef {
  readonly manifest: string;                   // sha256 hex of the revision manifest = the revision id
  readonly rev: number;                        // 1 for the first revision, +1 per commit on this record
  readonly base: string | null;                // parent revision (M3 fork detection); null for the first
  /** Copy of the manifest's skin palette for `skin.skeleton` meshes (M6b), in palette order. [] without a skin **and
   *  [] for an imported skin** (`skin: {asset, skin}`): its palette is the glTF skin's joints, identified only in the
   *  `skin.*` layer meta, never as JointIds (M6a creates no JointRecords, so they would all look dangling). */
  readonly joints: readonly JointId[];
}
export interface AssetMaterialRef { readonly asset: AssetId; readonly material: number }   // glTF material index
export type MeshMaterial =
  | { readonly preset: 'unlit' | 'toon' | 'lit' }                               // authored meshes ('toon' needs M6b)
  | { readonly assetSlots: readonly AssetMaterialRef[] };                       // made editable: face material = slot
export type ColourOutput = 'palette-texture' | 'vertex-colour' | 'material-per-colour';
export type MeshBudget = { readonly preset: BudgetPresetId } | { readonly tris: number } | null;
export type BudgetPresetId = 'hero' | 'npc' | 'boss' | 'handheld' | 'small-prop' | 'medium-prop' | 'building';
export interface HandheldGrip {                // asset.extras.ekza_handheld_v1 (registry handheld-glb-v1)
  readonly bone: 'rightHand' | 'leftHand';
  readonly offset: ReadonlyVec3;               // metres, each |c| ≤ 0.3
  readonly rotationDegrees: ReadonlyVec3;      // each |c| ≤ 360
  readonly scale: number;                      // 0.25…2
}
export interface MeshRecord {
  readonly id: MeshId;
  readonly name: string;                       // ≤ 64 chars, unique per owner (repair appends ' 2')
  readonly owner: MeshOwner;                   // partition: char:<id> | scene
  readonly parent: GroupId | MeshId | null;    // same owner only
  readonly order: string;                      // fractional index among siblings
  readonly placement: ReadonlyXf;              // object transform relative to the parent (character root for owner.character)
  readonly pivot: ReadonlyVec3;                // rotate/scale pivot in object space (D), default [0,0,0]
  readonly source: { readonly asset: AssetId; readonly mesh: number } | null;   // glTF mesh it edits; null = authored
  /** null is reserved (an asset-backed record without a revision): M6a never writes it. A glTF mesh that is not made
   *  editable has **no record**; `mesh.makeEditable` creates the record and its first revision in one transaction. */
  readonly data: MeshRef | null;
  readonly faceted: boolean;                   // true for meshes made in the editor; smoothingAngle default 0° (§5.3)
  readonly generator: { readonly kind: PrimitiveKind; readonly params: Readonly<Record<string, number | boolean | string>>;
    readonly version: 1 } | null;              // live primitive parameters; null after the first component edit
  readonly palette: PaletteId | null;
  readonly material: MeshMaterial;
  readonly colourOutput: ColourOutput;         // default 'palette-texture'
  readonly skin: { readonly skeleton: SkeletonId; readonly bind: Readonly<Record<string, JsonValue>> | null }   // M6b
              | { readonly asset: AssetId; readonly skin: number } | null;  // imported skin (glTF skin index)
  readonly budget: MeshBudget;                 // null = the export profile's default
  readonly handheld: HandheldGrip | null;      // only meaningful on an export root (§5.22)
  readonly deleted: Tombstone;
}
export interface GroupRecord {                 // Ctrl+G transform nodes
  readonly id: GroupId;
  readonly name: string;
  readonly owner: MeshOwner;
  readonly parent: GroupId | null;
  readonly order: string;
  readonly placement: ReadonlyXf;
  readonly pivot: ReadonlyVec3;
  readonly template: { readonly kind: 'prop' | 'handheld' | 'humanoid'; readonly params: Readonly<Record<string, number | string | boolean>> } | null;
  readonly budget: MeshBudget;
  readonly handheld: HandheldGrip | null;
  readonly deleted: Tombstone;
}
export interface PaletteRecord {
  readonly id: PaletteId;
  readonly name: string;                       // 'Ekza Default 16'
  readonly order: string;
  readonly deleted: Tombstone;
}
export interface SwatchRecord {
  readonly id: SwatchId;
  readonly palette: PaletteId;
  /** u16 0…65534, unique among the palette's swatches including deleted ones, never reused; faces store it. */
  readonly slot: number;
  readonly order: string;                      // display order in the panel
  readonly name: string;
  readonly srgb: readonly [number, number, number];   // 8-bit sRGB integers 0…255
  readonly kind: 'flat' | 'ramp';              // 'ramp' is M6a-stretch (validation accepts it; M6a renders it flat)
  readonly ramp: readonly [readonly [number, number, number], readonly [number, number, number]] | null;
  // Swatches table version 2 (SHADING-SPEC §2, ADR 0019): a swatch is the material of the faces painting its slot.
  readonly shader: SwatchShader;               // default 'lambert'
  readonly glossiness: number;                 // 0…1, Blinn highlight tightness (default 0.5; roughness = 1 − it)
  readonly specular: readonly [number, number, number];   // 8-bit sRGB Blinn highlight colour (default white)
  readonly deleted: Tombstone;
}
/** Shading model of a swatch (SHADING-SPEC §1). */
export type SwatchShader = 'lambert' | 'blinn';
/** The shader fields a swatch takes when they are missing (the swatches v1 → v2 migration, repairs, factories). */
export const SWATCH_SHADER_DEFAULTS: {
  readonly shader: SwatchShader;
  readonly glossiness: number;
  readonly specular: readonly [number, number, number];
} = { shader: 'lambert', glossiness: 0.5, specular: [255, 255, 255] };
export type OrthoCamera = 'front' | 'side' | 'top';
export interface ImagePlaneRecord {            // scene partition; never picked, never exported
  readonly id: ImagePlaneId;
  readonly name: string;
  readonly camera: OrthoCamera;                // front = looking along −Z, side = along −X, top = along −Y
  readonly asset: AssetId;                     // AssetRecord role 'reference-image'
  readonly offset: readonly [number, number];  // metres, in the camera plane (right, up)
  readonly size: number;                       // displayed image height in metres (default 2)
  readonly opacity: number;                    // 0…1 (default 0.5)
  readonly depth: 'behind' | 'front';          // default 'behind'
  readonly locked: boolean;
  readonly visible: boolean;
  readonly order: string;
  readonly deleted: Tombstone;
}
export interface SkeletonRecord {              // M6b creates them; M6a validates and preserves
  readonly id: SkeletonId;
  readonly character: CharacterId;
  readonly template: 'vrm-humanoid' | 'generic';
  readonly templateVersion: string;
  readonly preset: 'lite17' | 'core21' | 'standard33' | 'full52' | 'custom';
  readonly symmetry: boolean;
  readonly deleted: Tombstone;
}
/** M6b v4. 'bone' deforms (a candidate of automatic weights); 'helper' and 'prop' do not deform: automatic methods skip
 *  them unless masked in, paint and the table may still weight them (with the lint skin.non-deforming-weighted).
 *  'helper' = the template root, sockets (§5.6.3), end and aim helpers; 'prop' = the attach point of a held prop
 *  (§5.6.2). */
export type JointRole = 'bone' | 'helper' | 'prop';
export interface JointRecord {                 // M6b creates them; M6a validates and preserves
  readonly id: JointId;
  readonly skeleton: SkeletonId;
  readonly parent: JointId | null;
  readonly order: string;
  readonly name: string;
  readonly humanBone: HumanBoneName | null;
  readonly restPosition: ReadonlyVec3;         // character space, metres
  readonly restRotation: ReadonlyQuat;         // identity by default
  readonly tail: ReadonlyVec3 | null;
  readonly side: Side;
  readonly mirror: JointId | null;
  readonly deleted: Tombstone;
  readonly role: JointRole;                   // v4
  /** v4: stable control-key stem, set once at creation and never changed by a rename: template joints the human bone
   *  or 'root'; other joints the sanitized name at creation (`sanitizeNodeName`), de-duplicated per skeleton with the
   *  shipped `#n` rule; `char.makeEditable` the import-time stem, so control ids equal the asset rig's (§5.23).
   *  Template keys of non-humanoid controls of model-sourced skeletons: fk.<key>, sec.<key>, prop.<key>, sock.<key>. */
  readonly key: string;
}

/** Helper used by the curve engine: a curve record + its keys as an AnimCurve. */
export type CurveWithKeys = { readonly curve: CurveRecord; readonly keys: readonly KeyRecord[] } & AnimCurve;
