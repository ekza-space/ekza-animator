// The Ekza Game Protocol's contract model (GAME-PROTOCOL-SPEC §4, Appendix A; ADR 0025; C1): `ekza.game-contract.v1`
// as Studio reads it — one game's rigs, sockets, packaging, rule table, slots (each of a kind: `animation`, `asset`,
// `socket`), families and targets with their sections and offers. Game-specific meaning lives only under `ext`, read by
// profile modules (`./profiles/*`); everything here is game-agnostic. Studio's target binding, slot statuses and
// checklists read only this model.

export const GAME_CONTRACT_SCHEMA = 'ekza.game-contract.v1';
/** The protocol minor this reader implements (§3.3). */
export const GAME_CONTRACT_READER_VERSION = '1.0';

export type ContractSlotKind = 'animation' | 'asset' | 'socket';
export type ContractTargetKind = 'character' | 'any' | 'item' | 'vehicle' | 'prop';
export type ContractPackageKind = 'character' | 'animation-pack' | 'asset-pack' | 'accessory';
export type ContractRuleSeverity = 'error' | 'warning';
export type ContractRuleScope = 'package' | 'animation' | 'asset' | 'socket' | 'rig' | 'rights';
export type ContractStage = 'tool' | 'hub' | 'builder' | 'game';
export type Vec3 = readonly [number, number, number];
/** Profile data by profile id (`ext["omoba.character.v1"]`). */
export type ContractExt = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** A named time the game uses in a clip (`contact`, `release`, `fire`, `footstep_l`, …). */
export interface MarkerSpec {
  readonly required: boolean;
  /** The latest time after the clip's start, or null (no limit). */
  readonly maxSecs: number | null;
  /** What to aim for (the default's time), or null. */
  readonly targetSecs: number | null;
}

/** An `animation` slot: one clip on a rig (§4.5). */
export interface AnimationSlotSpec {
  readonly rig: string;
  readonly playback: 'loop' | 'action' | 'hold';
  readonly loop: boolean;
  readonly inPlace: boolean;
  readonly window: { readonly minSecs: number; readonly targetSecs: number; readonly maxSecs: number };
  readonly markers: Readonly<Record<string, MarkerSpec>>;
  readonly minIntervalSecs: number | null;
  /** The game's own lead-in (a wind-up, a telegraph) before the clip starts. */
  readonly leadInSecs: number | null;
}

/** An `asset` slot: a separate object the game shows (§4.5). Read and shown in C1; filled with GP5/GP6. */
export interface AssetSlotSpec {
  readonly role: 'handheld' | 'projectile' | 'throwable' | 'deployable' | 'attachment' | 'effect';
  readonly socket: string | null;
  readonly rootName: string | null;
  readonly nodes: { readonly required: readonly string[]; readonly optional: readonly string[] };
  readonly anchors: Readonly<
    Record<
      string,
      {
        readonly required: boolean;
        readonly default: Vec3 | null;
        readonly boxM: { readonly min: Vec3; readonly max: Vec3 } | null;
      }
    >
  >;
  readonly axes: {
    readonly origin: 'grip' | 'center' | 'base' | 'socket';
    readonly up: AxisName;
    readonly forward: AxisName;
  };
  readonly sizeM: { readonly boxMin: Vec3 | null; readonly boxMax: Vec3 | null };
  readonly budget: {
    readonly maxTriangles: number | null;
    readonly maxNodes: number;
    readonly maxMeshes: number;
    readonly maxMaterials: number | null;
    readonly maxImages: number;
    readonly maxTextureSize: number;
    readonly maxTexturePixels: number;
  };
  readonly materials: {
    readonly extensionsAllowed: readonly string[];
    readonly imageFormats: readonly ('png' | 'jpeg' | 'webp' | 'ktx2')[];
    readonly maxEmissiveStrength: number | null;
  };
  readonly motion: 'static' | 'named-parts' | 'node-animation' | 'skinned';
}
export type AxisName = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';

/** A `socket` slot: a character package's own placement of a socket (§4.5). */
export interface SocketSlotSpec {
  readonly socket: string;
  readonly maxOffsetM: number;
  readonly maxRotationDeg: number;
}

/** The game's default for a slot: what plays or shows when a package leaves the slot empty. */
export interface ContractSlotDefault {
  readonly name: string;
  /** As played (animations), or null. */
  readonly playSecs: number | null;
  readonly loop: boolean | null;
  /** Marker times as played (seconds). */
  readonly markers: Readonly<Record<string, number>>;
  /** A preview file the game publishes (served by Hub by SHA-256), or null. */
  readonly preview: {
    readonly sha256: string;
    readonly bytes: number;
    readonly format: 'vrma' | 'glb' | 'png';
    readonly license: string;
  } | null;
}

/** The fields a slot and a family share. */
export interface ContractSlotBody {
  readonly kind: ContractSlotKind;
  readonly label: string;
  readonly description: string | null;
  readonly customizable: boolean;
  /** The profile minor that opens a fixed slot (`"1.1"`), or null. */
  readonly customizableFrom: string | null;
  readonly reserved: boolean;
  readonly required: boolean;
  readonly default: ContractSlotDefault | null;
  /** Exactly one of the three is non-null, by `kind`. */
  readonly animation: AnimationSlotSpec | null;
  readonly asset: AssetSlotSpec | null;
  readonly socket: SocketSlotSpec | null;
  readonly usedBy: readonly string[];
  readonly ext: ContractExt;
}

export interface ContractSlotSpec extends ContractSlotBody {
  readonly id: string;
  readonly sharesDefaultWith: readonly string[];
  readonly alternatesWith: readonly string[];
}

/** An extensible list: a slot template a package may instantiate as `<idPrefix>.<name>` (§4.6). */
export interface ContractFamily extends ContractSlotBody {
  readonly id: string;
  readonly idPrefix: string;
  readonly minFills: number;
  readonly maxFills: number;
}

/** What a target takes from one package kind (§4.7). */
export interface ContractOffer {
  readonly package: ContractPackageKind;
  readonly requirementId: string;
  readonly label: string;
  readonly slots: readonly string[];
  readonly families: readonly string[];
  readonly listing: 'every-customizable-slot' | 'filled-slots-only';
  readonly mustFill: readonly string[];
}

/** A labelled group of a target's slots in checklist order (Base, Basic attack, Q …, Gear). */
export interface ContractSection {
  readonly id: string;
  readonly label: string;
  /** The input hint shown with it (`Q`), or null. */
  readonly key: string | null;
  readonly slots: readonly string[];
}

/** One thing of the game a creator can make for: a hero class, `any` character, an item, a vehicle, a prop. */
export interface ContractTarget {
  readonly id: string;
  readonly kind: ContractTargetKind;
  readonly name: string;
  readonly subtitle: string | null;
  readonly sections: readonly ContractSection[];
  readonly slots: readonly string[];
  readonly families: readonly string[];
  readonly accepts: readonly ContractOffer[];
  readonly ext: ContractExt;
}

export interface ContractRuleSpec {
  readonly id: string;
  readonly severity: ContractRuleSeverity;
  readonly scope: ContractRuleScope;
  readonly params: Readonly<Record<string, unknown>>;
  readonly checkedBy: readonly ContractStage[];
  /** A namespaced rule this reader does not implement: shown as "checked by the game when you submit" (§7.3). */
  readonly deferred: boolean;
}

export interface ContractRig {
  readonly kind: 'vrm-humanoid';
  readonly sourceFormats: readonly ('vrm1' | 'vrm0')[];
  readonly restPose: 't-pose' | 'a-pose' | 'any';
  readonly facing: 'as-vrm-spec';
  readonly requiredBones: readonly string[];
  readonly requiredBonesVrm0: readonly string[];
  readonly drivenBones: readonly string[];
  readonly maxHumanoidBones: number;
  readonly maxNodes: number;
  readonly uniformScale: 'humanoid-bones-and-ancestors' | 'none';
  readonly fingers: 'optional' | 'required';
  readonly thumbsRecommended: boolean;
  readonly lengthUnit: { readonly name: 'legLength'; readonly from: 'hips-to-feet'; readonly referenceM: number };
  readonly ext: ContractExt;
}

export interface ContractSocket {
  readonly label: string;
  readonly rig: string;
  readonly bone: string;
  readonly frame: 'bone' | 'palm' | 'authored';
  readonly fillable: boolean;
  readonly ext: ContractExt;
}

export interface ContractPackaging {
  readonly containers: readonly ('vrm1' | 'vrm0' | 'glb' | 'vrma')[];
  readonly manifestKey: 'ekza_package_v1';
  readonly slotKinds: readonly ContractSlotKind[];
  readonly maxBytes: number;
  readonly maxJsonBytes: number;
  readonly maxFills: number;
  readonly binding: 'manifest' | 'manifest-or-names';
  readonly rendition: { readonly platform: string; readonly profile: string; readonly version: number } | null;
  readonly ext: ContractExt;
}

/** A parsed, verified `ekza.game-contract.v1` document. */
export interface ContractModel {
  readonly schema: typeof GAME_CONTRACT_SCHEMA;
  readonly schemaVersion: string;
  readonly minReaderVersion: string;
  /** The game (Hub project id): `omoba`. */
  readonly game: string;
  readonly gameName: string;
  readonly revision: string;
  readonly previousRevision: string | null;
  readonly license: string;
  readonly source: { readonly commit: string | null; readonly exporter: string; readonly inputsSha256: string };
  readonly profiles: { readonly used: readonly string[]; readonly required: readonly string[] };
  readonly rigs: Readonly<Record<string, ContractRig>>;
  readonly sockets: Readonly<Record<string, ContractSocket>>;
  readonly packaging: Readonly<Partial<Record<ContractPackageKind, ContractPackaging>>>;
  readonly rules: readonly ContractRuleSpec[];
  readonly slots: Readonly<Record<string, ContractSlotSpec>>;
  readonly families: Readonly<Record<string, ContractFamily>>;
  readonly targets: readonly ContractTarget[];
  readonly retired: {
    readonly slots: Readonly<Record<string, string>>;
    readonly targets: Readonly<Record<string, string>>;
    readonly families: Readonly<Record<string, string>>;
  };
  readonly ext: ContractExt;
  /** Keys a newer minor added that this reader skipped (§3.3), by path; empty for a document it fully knows. */
  readonly ignoredKeys: readonly string[];
}

/** The target `id` of a contract, or undefined. */
export function contractTarget(model: ContractModel, id: string): ContractTarget | undefined {
  return model.targets.find((target) => target.id === id);
}

/** The rule `id` of a contract, or undefined (a rule the contract does not list is not checked). */
export function contractRule(model: ContractModel, id: string): ContractRuleSpec | undefined {
  return model.rules.find((rule) => rule.id === id);
}

/** The offer of a target for a package kind (the first one), or undefined. */
export function contractOffer(target: ContractTarget, kind: ContractPackageKind): ContractOffer | undefined {
  return target.accepts.find((offer) => offer.package === kind);
}
