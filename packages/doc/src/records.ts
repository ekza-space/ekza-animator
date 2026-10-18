// Contract file: MVP-SPEC §4.2, copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { AnimCurve, ControlShapeKind, Fps, Frame, InfinityMode, KeyData, ReadonlyQuat, ReadonlyXf,
  RotateOrder, SplineSet } from '@ekza-animator/anim-core';
import type { AssetId, CameraId, CharacterId, ClipId, ConstraintId, ControlId, CurveId, KeyId, LayerId, RigId,
  SolverId, UserId } from './ids';

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

export interface AssetRecord {
  readonly id: AssetId;                        // sha256 hex
  readonly name: string;                       // original file name
  readonly ext: 'glb' | 'vrm' | 'vrma';
  readonly mime: 'model/gltf-binary';          // no registered media type exists for VRM/VRMA (research 03 §7.2)
  readonly size: number;
  readonly role: 'model' | 'animation-source';
}

export interface CharacterRecord {
  readonly id: CharacterId;
  readonly name: string;
  readonly asset: AssetId;
  readonly format: ModelFormat;
  readonly rig: RigId;
  readonly placement: ReadonlyXf;              // scene placement of the character root (MVP: offset along X per character)
  readonly order: string;                      // fractional index
  readonly deleted: Tombstone;
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
}

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
  readonly stepped?: boolean;
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
  readonly attrs: Readonly<Record<string, AttrDef>>;   // empty in the MVP
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
  | { readonly kind: 'imported'; readonly fileName: string; readonly asset: AssetId | null };

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
}
export type TableName = keyof Tables;
export type RecordOf<T extends TableName> = Tables[T];
export type IdOf<T extends TableName> = Tables[T]['id'];
export type AnyRecord = Tables[TableName];
export type SoftDeletableTable = Exclude<TableName, 'project' | 'assets' | 'keys'>;
export const BUILTIN_TABLES = [
  'project', 'assets', 'characters', 'rigs', 'controls', 'constraints', 'solvers', 'cameras', 'clips', 'layers',
  'curves', 'keys',
] as const;
export type BuiltinTableName = (typeof BUILTIN_TABLES)[number];

/** CRDT document boundary (ADR 0002): scene | char:<CharacterId> | clip:<ClipId>. */
export type Partition = 'scene' | `char:${string}` | `clip:${string}`;

/** Unit of last-writer-wins merge and of compare-before-restore undo (research 06 R3). */
export type MergeUnit = 'record' | 'field';
export const MERGE_UNIT: Readonly<Record<BuiltinTableName, MergeUnit>> = {
  project: 'field', assets: 'record', characters: 'field', rigs: 'field', controls: 'field',
  constraints: 'field', solvers: 'field', cameras: 'field', clips: 'field', layers: 'field', curves: 'field',
  keys: 'record',
};

/** WP-2 addition (docs/wp-notes/wp-2.md): resolves what a record alone cannot tell — rig-scoped records (controls,
 *  constraints, solvers) reference only their rig, and their partition is `char:<the rig's character>`. Stores pass
 *  a lookup over their own state; an unknown rig yields `undefined` (the record then belongs to `scene`). */
export interface PartitionLookup {
  rigCharacter(rig: RigId): CharacterId | undefined;
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

/** Helper used by the curve engine: a curve record + its keys as an AnimCurve. */
export type CurveWithKeys = { readonly curve: CurveRecord; readonly keys: readonly KeyRecord[] } & AnimCurve;
