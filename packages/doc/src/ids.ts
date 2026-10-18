// Contract file: MVP-SPEC §4.2 with the M6A-SPEC §4.2 additions, copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type AssetId = Brand<string, 'AssetId'>;         // lowercase SHA-256 hex of the exact bytes
export type CharacterId = Brand<string, 'CharacterId'>; // 'chr_' + 16 base62
export type RigId = Brand<string, 'RigId'>;             // 'rig_' + 16
/** Auto-rig: `${RigId}:${templateKey}` (deterministic, e.g. 'rig_a1…:fk.upperArm.L'). User-created (V1): 'ctl_' + 16. */
export type ControlId = Brand<string, 'ControlId'>;
export type ConstraintId = Brand<string, 'ConstraintId'>; // 'cns_' + 16
export type SolverId = Brand<string, 'SolverId'>;         // 'slv_' + 16
export type CameraId = Brand<string, 'CameraId'>;         // 'cam_' + 16
export type ClipId = Brand<string, 'ClipId'>;             // 'clp_' + 16
export type LayerId = Brand<string, 'LayerId'>;           // 'lay_' + 16
export type CurveId = Brand<string, 'CurveId'>;           // 'crv_' + 16
export type KeyId = Brand<string, 'KeyId'>;               // 'k_' + 12
export type UserId = Brand<string, 'UserId'>;             // 'local' in the MVP
export type ProjectId = 'project';

// ---------- M6a (M6A-SPEC §4.2) ----------
export type MeshId = Brand<string, 'MeshId'>;               // 'msh_' + 16 base62
export type GroupId = Brand<string, 'GroupId'>;             // 'grp_' + 16
export type PaletteId = Brand<string, 'PaletteId'>;         // 'pal_' + 16
export type SwatchId = Brand<string, 'SwatchId'>;           // 'sw_' + 16
export type ImagePlaneId = Brand<string, 'ImagePlaneId'>;   // 'img_' + 16
export type SkeletonId = Brand<string, 'SkeletonId'>;       // 'skl_' + 16 (M6b creates them)
/** Template joints: `${SkeletonId}:${HumanBoneName}` (deterministic); user joints 'jnt_' + 16 (M6b). */
export type JointId = Brand<string, 'JointId'>;

/** ID type per kind, for the typed `newId(kind)` (WP-0). */
export interface IdOfKind {
  character: CharacterId; rig: RigId; constraint: ConstraintId; solver: SolverId; camera: CameraId; clip: ClipId;
  layer: LayerId; curve: CurveId; key: KeyId; tx: string;
  mesh: MeshId; group: GroupId; palette: PaletteId; swatch: SwatchId;
  imagePlane: ImagePlaneId; skeleton: SkeletonId; joint: JointId }                       // changed (additive, M6a)
export type IdKind = keyof IdOfKind;
/** Randomness source; tests and `?e2e=1` inject a seeded one. */
export interface IdSource { randomBytes(n: number): Uint8Array }
