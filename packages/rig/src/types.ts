// Contract file: MVP-SPEC §4.3 with the M2A-SPEC §4.3 additions, copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { CurveEngine, Fps, Frame, InfinityMode, KeyData, Mat4, Quat, ReadonlyQuat, ReadonlyVec3, ReadonlyXf,
  RotateOrder } from '@ekza-animator/anim-core';
import type { AttrDef, BoneRef, ChannelId, ChannelValues, ClipId, ConstraintRecord, ControlId, ControlRecord,
  HumanBoneName, ModelFormat, RigId, RigRecord, SolverId, SolverRecord } from '@ekza-animator/doc';

/** One glTF node, in topological order (parents before children). */
export interface SkeletonNode {
  readonly index: number;                      // index into SkeletonDesc.nodes
  readonly gltfIndex: number;                  // index into the source glTF `nodes` (runtime use only)
  readonly name: string;                       // raw glTF name ('' if absent)
  readonly parent: number;                     // index into nodes, -1 for scene roots
  readonly restLocal: ReadonlyXf;              // from TRS or decomposed `matrix`
  readonly hasMatrix: boolean;                 // node uses `matrix` (surgeon refuses to animate it)
  readonly isJoint: boolean;                   // referenced by any skin.joints
  readonly hasMesh: boolean;
}

/** VRMC_node_constraint entry (preview only; never baked for VRM consumers). */
export interface NodeConstraintDesc {
  readonly type: 'roll' | 'aim' | 'rotation';
  readonly source: number;                     // node index
  readonly destination: number;                // node index
  readonly weight: number;
}

/** Pure data extracted from glTF JSON and BIN (no three.js). */
export interface SkeletonDesc {
  readonly format: ModelFormat;
  readonly facing: ReadonlyQuat;               // model → canonical character space (+Z forward); VRM 0.x: π yaw
  readonly nodes: readonly SkeletonNode[];
  readonly humanoid: Readonly<Partial<Record<HumanBoneName, number>>> | null;   // node index; VRM 0.x thumbs aliased to 1.0 names
  readonly springJoints: readonly number[];    // node indices in VRMC_springBone / VRM0 secondaryAnimation chains
  readonly nodeConstraints: readonly NodeConstraintDesc[];
  readonly constrainedNodes: readonly number[];// destinations of nodeConstraints (no controls, never baked)
  /** Per node: 1.25 × P90 distance from the bone segment of bind-pose vertices whose dominant weight (≥ 0.5)
   *  is this joint; metres, canonical space. null when unknown (compressed or unskinned meshes). */
  readonly boneRadii: readonly (number | null)[];
  readonly height: number;                     // H, metres: skinned bind-pose bounds height, else joint estimate
  readonly heightSource: 'mesh' | 'joints';
  readonly fingerprint: string;                // 'sha256:<hex>'
  readonly ekzaHeightScale: number | null;     // extras.ekza.avatar.heightScale (root extras or asset.extras)
  readonly warnings: readonly string[];        // e.g. non-uniform joint scale, shear in matrices
  /**
   * Per node: the horizontal support function of the rest-pose vertices whose dominant skin weight is that node,
   * relative to the node's rest position p, in character space: 32 values h_k = max over those vertices of
   * ((v − p).x·sin θ_k + (v − p).z·cos θ_k), θ_k = k·11.25°, then 2 values min (v − p).y and max (v − p).y. null for
   * nodes without such vertices; the array is absent without mesh data (§5.2.3). A humanoid lower leg's vertices
   * below its foot's rest position count for the foot (rigs often skin the heel to the shin; A1 notes).
   */
  readonly boneSupport?: readonly (Float32Array | null)[];
}

/** Assembled view of the rig records (readRigDefinition). */
export interface RigDefinition {
  readonly rig: RigRecord;
  readonly controls: readonly ControlRecord[];
  readonly constraints: readonly ConstraintRecord[];
  readonly solvers: readonly SolverRecord[];
}

export interface RigWarning {
  readonly code: 'dangling-ref' | 'cycle' | 'unsupported-op' | 'non-uniform-scale' | 'missing-bone' | 'duplicate-binding' | 'shear' | 'asymmetric-rest' | 'unpaired-mirror';   // unpaired-mirror: v0.3 integration (WP-3 R-5)
  readonly message: string;
  readonly ids: readonly string[];
}

/** Slot order per control: tx ty tz rx ry rz sx sy sz. */
export const CHANNELS_PER_CONTROL = 9;
export interface ChannelBuffer {
  readonly values: Float64Array;               // controlCount * 9; defaults 0 (t, r) and 1 (s)
  readonly attrs: Float64Array;                // one slot per RigProgram.attrSlots entry (M2a), defaults AttrDef.default
}

// ---------- M2a: limbs, attribute slots, ik2 (M2A-SPEC §4.3) ----------

/** A limb that can carry two-bone IK. */
export type LimbId = 'leg.L' | 'leg.R' | 'arm.L' | 'arm.R';
export const LIMB_IDS: readonly LimbId[] = ['leg.L', 'leg.R', 'arm.L', 'arm.R'];
/** Attribute names on a limb's IK control. Legs carry all seven, arms the first three. */
export const LIMB_ATTR: { readonly ikFk: 'ikFk'; readonly soft: 'soft'; readonly twist: 'twist'; readonly roll: 'roll';
  readonly bank: 'bank'; readonly heelTwist: 'heelTwist'; readonly toeTwist: 'toeTwist' } = {
  ikFk: 'ikFk', soft: 'soft', twist: 'twist', roll: 'roll', bank: 'bank', heelTwist: 'heelTwist', toeTwist: 'toeTwist',
};
export type LimbAttr = keyof typeof LIMB_ATTR;

/** `${ControlId}/@${name}`: key of an attribute slot. */
export type AttrKey = `${string}/@${string}`;
export interface AttrSlot { readonly control: ControlId; readonly name: string; readonly def: AttrDef }

/**
 * Foot-roll pivots of a leg (§5.2.3), in the IK control's REST frame (origin = its rest position, character axes,
 * metres). The pivots lie on the foot line: with f = R_y(yaw)·(0, 0, 1) and l = side·R_y(yaw)·(1, 0, 0) (outward),
 * heel = ground − f·heelBack, ball = ground + f·ballFront, toe tip = ball + f·toeFront,
 * inner = ball − l·innerWidth, outer = ball + l·outerWidth.
 */
export interface FootRollParams {
  readonly side: 1 | -1;                       // +1 left, −1 right
  readonly ground: ReadonlyVec3;               // the ankle projected to the ground plane
  readonly yaw: number;                        // ψ: rotation about +y from +z to the foot's forward direction f
  readonly heelBack: number;                   // metres, ≥ 0
  readonly ballFront: number;
  readonly toeFront: number;
  readonly innerWidth: number;
  readonly outerWidth: number;
  readonly breakAngle: number;                 // β, radians in [0, π/2]; default π/6
}

/** `SolverRecord.params` for `type: 'ik2'` (version 1). Unknown fields are preserved. */
export interface Ik2Params {
  readonly v: 1;
  readonly limb: LimbId;
  readonly bones: { readonly upper: BoneRef; readonly mid: BoneRef; readonly end: BoneRef; readonly toes: BoneRef | null };
  readonly fk: { readonly upper: ControlId; readonly mid: ControlId; readonly end: ControlId; readonly toes: ControlId | null };
  readonly ikControl: ControlId;               // owns the LIMB_ATTR attributes
  readonly pole: ControlId;
  /** Unit hinge axis in canonical character space at rest, + = flexion (§5.2 table). */
  readonly hinge: readonly [number, number, number];
  readonly foot: FootRollParams | null;        // legs; null for arms
}

/** A compiled, enabled `ik2` solver. */
export interface LimbDesc {
  readonly id: LimbId;
  readonly solver: SolverId;
  readonly params: Ik2Params;
  readonly nodes: { readonly upper: number; readonly mid: number; readonly end: number; readonly toes: number };   // toes −1 when absent
  /** ChannelBuffer.attrs slot per limb attribute; −1 when the IK control lacks it. */
  readonly attrSlots: Readonly<Record<LimbAttr, number>>;
  /** l1, l2 (rest, scaled) and d⁰ = rest |end − upper| (§5.3 amendment A). */
  readonly lengths: { readonly upper: number; readonly lower: number; readonly restReach: number };
  readonly fkControls: readonly ControlId[];   // fk.upper, fk.mid, fk.end: hidden in full IK (§5.5)
  readonly ikControls: readonly ControlId[];   // ik control, pole: hidden in full FK
}

/**
 * Compile-time view handed to rig op implementations (§5.4). Everything in it is known before scheduling:
 * attribute slots are ordered schedule-independently, so `attrSlot` answers inside `reads`/`writes` too.
 */
export interface RigOpCompileContext {
  readonly skeleton: SkeletonDesc;
  readonly controls: ReadonlyMap<ControlId, ControlRecord>;
  resolveBone(ref: BoneRef): number;                                     // node index, −1 when absent
  attrSlot(control: ControlId, name: string): number;                    // −1 when absent
  controlChildren(control: ControlId): readonly ControlId[];             // by order, then id
  nodeChildren(node: number): readonly number[];
}

/** Evaluation output. Allocate with RigProgram.allocPose(); written by evaluate() without allocation. */
export interface PoseBuffers {
  readonly boneLocal: Float64Array;            // nodeCount * 10: t(3) q(4) s(3), raw glTF node local space
  readonly boneWorld: Float64Array;            // nodeCount * 16: mat4, canonical character space
  readonly controlWorld: Float64Array;         // controlCount * 16: mat4, canonical character space
  /** 55 * 4: normalized local rotation N_b = D_parent⁻¹·D_b (D = world rotation delta from rest, parent = nearest
   *  present humanoid ancestor; hips: D_hips). Canonical (+Z) space. Identity when the bone is absent. */
  readonly humanLocal: Float64Array;
  readonly hipsPosition: Float64Array;         // 3: hips world position, canonical character space
  version: number;                             // incremented by every evaluate()
}

export interface RigProgram {
  readonly rigId: RigId;
  readonly skeleton: SkeletonDesc;
  readonly controlIds: readonly ControlId[];   // slot order (schedule order)
  readonly controlIndex: ReadonlyMap<ControlId, number>;
  readonly controls: readonly ControlRecord[]; // same order as controlIds
  readonly nodeCount: number;
  readonly drivenNodes: readonly number[];     // node indices written by bindBone ops (exported as animated)
  readonly warnings: readonly RigWarning[];
  /**
   * Custom attribute slots ordered by (control id, attribute name), code-unit order: independent of the schedule,
   * so adding or removing an op never renumbers them, and known before ops declare their reads and writes.
   */
  readonly attrSlots: readonly AttrSlot[];
  readonly attrIndex: ReadonlyMap<AttrKey, number>;
  /** Enabled ik2 solvers that compiled, in solver-id order (§5.4 rule 4). */
  readonly limbs: readonly LimbDesc[];
  allocChannels(): ChannelBuffer;
  allocPose(): PoseBuffers;
  resetChannels(ch: ChannelBuffer): void;
  evaluate(ch: ChannelBuffer, out: PoseBuffers): void;
}

/** Per-curve facts used by keying UI and by the bake step schedule. */
export interface CurveInfo {
  readonly channel: ChannelId;
  readonly keyTimes: readonly Frame[];          // sorted, unique, clip frames
  readonly steppedThroughout: boolean;          // every key's out type is 'step' (and ≥ 1 key)
  readonly pre: InfinityMode;
  readonly post: InfinityMode;
}

/** Per-clip sampler (curves ⊕ preview overlay via the store). Times are clip frames. */
export interface ClipSampler {
  readonly clip: ClipId;
  /** Writes base-layer curve values; key-less curves give staticValue ?? default; no curve → default. */
  sample(frame: Frame, out: ChannelBuffer): void;
  /** undefined when the channel has no curve in this clip. */
  value(control: ControlId, channel: ChannelId, frame: Frame): number | undefined;
  /** Union of key times (sorted, unique) of the given controls' curves (all controls when null). */
  keyTimes(controls: readonly ControlId[] | null): readonly Frame[];
  curveInfo(control: ControlId): readonly CurveInfo[];
  dispose(): void;
}

/** Raw glTF animation data (produced by io.readAnimations, consumed by importRawClip). */
export type AnimPath = 'translation' | 'rotation' | 'scale' | 'weights';
export interface RawChannel {
  readonly node: number;                       // SkeletonDesc node index (io maps glTF index → node index)
  readonly path: AnimPath;
  readonly interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
  readonly times: Float32Array;                // seconds, strictly increasing
  readonly values: Float32Array;               // count × components (× 3 for CUBICSPLINE: in, value, out)
}
export interface RawClip {
  readonly index: number;                      // glTF animation index
  readonly name: string;
  readonly duration: number;                   // seconds
  readonly channels: readonly RawChannel[];
  readonly skipped: readonly { readonly reason: 'no-target-node' | 'pointer' | 'unsupported-path' | 'unmatched-node'; readonly channel: number }[];
}

/** Normalized humanoid motion (VRMA import), canonical space (§4.11.7). */
export interface HumanoidClipData {
  readonly name: string;
  readonly duration: number;                   // seconds
  readonly presentBones: readonly HumanBoneName[];   // humanoid bones mapped in the source file
  readonly rotations: Readonly<Partial<Record<HumanBoneName, { readonly times: Float32Array; readonly values: Float32Array }>>>;
  readonly hips: { readonly times: Float32Array; readonly values: Float32Array } | null;   // absolute positions
  readonly restHipsPosition: ReadonlyVec3;
  readonly interpolation: Readonly<Partial<Record<HumanBoneName | 'hipsPosition', 'LINEAR' | 'STEP' | 'CUBICSPLINE'>>>;
}

/** Tolerances for key reduction on import and for Graph Editor Simplify. */
export interface ReduceSpec {
  readonly rotationRad: number;                // default 0.1° = 0.0017453292519943296
  readonly translationM: number;               // default 0.0005
  readonly scale: number;                      // default 1e-4 (unitless)
}
export const DEFAULT_REDUCE: ReduceSpec = { rotationRad: 0.0017453292519943296, translationM: 0.0005, scale: 1e-4 };

export interface ImportRawOptions {
  readonly fps: Fps;                           // clip fps: detected source fps, else project scene fps
  readonly keyMode: 'source-times' | 'resample';
  readonly eulerFilter: boolean;
  readonly reduce: ReduceSpec | null;
  /** §5.8: 'auto' (default) writes IK controls for limbs whose ikFk default is ≥ 0.5; 'none' writes FK only (M1). */
  readonly ik?: 'auto' | 'none';
  /** §5.8 fidelity check of 'auto'; default { rotationRad: 2° = 0.03490658503988659, positionM: 0.002 }. */
  readonly ikTolerance?: { readonly rotationRad: number; readonly positionM: number };
}
export interface ImportHumanoidOptions extends ImportRawOptions {
  /** 'auto': target rest hips height / source restHipsPosition.y (VRMA convention). */
  readonly hipsScale: 'auto' | number;
}

export interface ImportedCurve {
  readonly control: ControlId;
  readonly channel: ChannelId;
  readonly keys: readonly KeyData[];
  readonly stats: { readonly sourceKeys: number; readonly maxReduceError: number };
}
export interface ImportedClipKeys {
  readonly fps: Fps;
  readonly range: { readonly start: Frame; readonly end: Frame };
  readonly curves: readonly ImportedCurve[];
  readonly warnings: readonly string[];        // dropped channels (spring joints, unrigged nodes, weights, …)
  /** M2a §5.8: one row per limb that ik 'auto' considered. */
  readonly limbs?: readonly { readonly limb: LimbId; readonly mode: 'ik' | 'fk'; readonly maxRotationErrorRad: number;
    readonly maxMidErrorM: number }[];
}

/** Clipboard payload (JSON, `text/plain`), research 07 §17. */
export interface PoseClipboard {
  readonly kind: 'ekza.pose';
  readonly version: 1;
  readonly rig: { readonly id: RigId; readonly fingerprint: string; readonly generator: string };
  readonly controls: Readonly<Record<string /* template key */, { readonly values: ChannelValues; readonly order: RotateOrder }>>;
}

export type MirrorMode = 'flip' | 'leftToRight' | 'rightToLeft';

/** Stateless analytic two-bone IK (research 07 §9.2): hinge + pole, optional softness. Canonical space. */
export interface TwoBoneIkInput {
  readonly parentWorld: Mat4;                  // evaluated world of the upper bone's parent
  readonly upperRest: ReadonlyXf;              // rest LOCAL transforms of the three chain bones
  readonly midRest: ReadonlyXf;
  readonly endRest: ReadonlyXf;
  readonly hingeLocal: ReadonlyVec3;           // unit hinge axis in the mid bone's local frame, + = flexion
  readonly target: ReadonlyVec3;               // desired end-bone position
  readonly pole: ReadonlyVec3;                 // world point defining the bend plane
  readonly twist: number;                      // radians about the chain axis, added to the pole twist
  readonly soft: number;                       // metres; 0 = off
  readonly endWorldRotation: ReadonlyQuat | null;   // null: end bone keeps its rest local rotation
  /** ik2 op only: enables the rest-exact amendments A, B and C of §5.3. Absent = M1 behaviour (Plant Feet). */
  readonly restReach?: number;
}
export interface TwoBoneIkOutput {
  upperLocal: Quat;                            // resulting LOCAL rotations (raw bone space)
  midLocal: Quat;
  endLocal: Quat;
  reached: boolean;
}

/** `${trackNode}/${path}`: raw target = SkeletonDesc node index; humanoid target = HUMAN_BONE_NAMES index. */
export type TrackKey = `${number}/${'translation' | 'rotation' | 'scale'}`;

/** A pinned foot for `Plant Feet`: the foot bone world captured by `pose.pinFeet`. */
export interface FootPin { readonly side: 'L' | 'R'; readonly footWorld: Mat4 }

export type { CurveEngine, Mat4 };
