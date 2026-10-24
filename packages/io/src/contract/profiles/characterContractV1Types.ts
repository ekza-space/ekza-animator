// `omoba.character-contract.v1` (CHARACTER-CONTRACT-SPEC §3, Appendix A; ADR 0024): OMOBA's description of the clips
// its heroes play, the rules a custom clip must pass and the per-hero views. These types mirror the JSON Schema of
// Appendix A field for field; `parseCharacterContract` (./parse.ts) produces them and refuses anything else.

export const CHARACTER_CONTRACT_V1_SCHEMA = 'omoba.character-contract.v1';
export type CharacterContractV1Schema = typeof CHARACTER_CONTRACT_V1_SCHEMA;

export type ContractV1SlotGroup = 'base' | 'basic' | 'skill';
export type ContractV1SlotRole = 'idle' | 'run' | 'walk' | 'death' | 'basic' | 'release' | 'recast' | 'windup';
export type ContractV1SlotKind = 'loop' | 'action' | 'hold';
export type ContractV1SlotPhase = 'locomotion' | 'state' | 'instant' | 'warn_fire' | 'fuse' | 'parry';
export type ContractV1RuleSeverity = 'error' | 'warning';
export type ContractV1Range = readonly [number, number];

export interface ContractV1Source {
  readonly commit: string;
  readonly exporter: string;
  readonly inputsSha256: string;
  readonly gameplayRevision: string;
  readonly presentationSha256: string;
  readonly motionLibrary: { readonly schemaVersion: number; readonly sha256: string; readonly clips: number };
  readonly protocolVersion: number;
}

export interface ContractV1Package {
  readonly extrasKey: 'ekza_animation_set_v1';
  readonly sourceFormats: readonly ('vrm1' | 'vrm0')[];
  readonly rendition: { readonly platform: string; readonly profile: string; readonly version: number };
  readonly slotNaming: 'animation-name-equals-slot-id';
  readonly customPlayback: { readonly rate: 1; readonly start: 0 };
}

export interface ContractV1Rig {
  readonly kind: 'vrm-humanoid';
  readonly restPose: 't-pose';
  readonly facing: 'as-vrm-spec';
  readonly requiredBones: readonly string[];
  readonly requiredBonesVrm0: readonly string[];
  readonly drivenBones: readonly string[];
  readonly maxHumanoidBones: number;
  readonly maxNodes: number;
  readonly uniformScale: 'humanoid-bones-and-ancestors' | 'none';
  readonly fingers: 'optional' | 'required';
  readonly thumbsRecommended: boolean;
  readonly legLengthFrom: 'hips-to-feet';
  readonly referenceLegLengthM: number;
}

export interface ContractV1Timing {
  readonly blendSecs: number;
  readonly idleGraceSecs: number;
  readonly facingHoldSecs: { readonly basic: number; readonly skill: number };
  readonly contactLimitSecs: number;
  readonly rowRate: ContractV1Range;
  readonly rowStart: ContractV1Range;
  readonly fitRate: ContractV1Range;
  readonly unseenHoldSecs: number;
  readonly freshSecs: number;
  readonly maxGapSecs: number;
  readonly deathCut: 'immediate';
  readonly movementInterruptsAction: boolean;
  readonly newActionRestarts: boolean;
}

/** One row of the rule table (§5.1): parameters are data, the logic of each id is code in each implementation. */
export interface ContractV1Rule {
  readonly id: string;
  readonly severity: ContractV1RuleSeverity;
  readonly scope: 'pack' | 'clip';
  readonly params: Readonly<Record<string, unknown>>;
}

/** The clip OMOBA plays in a slot when the package has none, with its row playback and the derived times. */
export interface ContractV1Default {
  readonly motion: string;
  readonly durationSecs: number;
  readonly looping: boolean;
  readonly contactSecs: number | null;
  readonly rate: number;
  readonly start: number;
  readonly playSecs: number;
  readonly effectiveContactSecs: number | null;
  readonly standInFor: string | null;
}

export interface ContractV1Slot {
  readonly group: ContractV1SlotGroup;
  readonly role: ContractV1SlotRole;
  readonly label: string;
  readonly kind: ContractV1SlotKind;
  readonly phase: ContractV1SlotPhase;
  readonly edgeReleased: boolean;
  readonly customizable: boolean;
  readonly customizableFrom: string | null;
  readonly reserved: boolean;
  readonly required: boolean;
  readonly default: ContractV1Default;
  readonly window: { readonly minSecs: number; readonly targetSecs: number; readonly maxSecs: number };
  readonly inPlace: boolean;
  readonly loop: boolean;
  readonly contact: {
    readonly required: boolean;
    readonly maxSecs: number | null;
    readonly targetSecs: number | null;
  } | null;
  readonly telegraph: {
    readonly secs: number;
    readonly serverWindupSecs: number | null;
    readonly fitWindup: boolean;
  } | null;
  readonly handheld: {
    readonly item: string;
    readonly byMode: Readonly<Record<string, string>>;
    readonly bone: string;
    readonly muzzleWindowSecs: ContractV1Range | null;
  } | null;
  readonly sharesDefaultWith: readonly string[];
  readonly alternatesWith: readonly string[];
  readonly usedBy: readonly string[];
  /** skill slots */
  readonly skill?: string;
  /** basic slots */
  readonly class?: string;
  readonly minIntervalSecs?: number;
  readonly weaponMode?: string;
}

export type ContractV1Key = 'q' | 'w' | 'e' | 'r';

/** `heroes[]`: one ordered view per class, plus `any` (base slots only). */
export interface ContractV1Hero {
  readonly id: string;
  readonly kind: 'class' | 'any';
  readonly name: string;
  readonly role: string | null;
  readonly requirementId: string;
  readonly basicAttack: {
    readonly rangeM: number;
    readonly cooldownSecs: number;
    readonly attackRateCap: number;
    readonly minIntervalSecs: number;
    readonly slots: readonly string[];
  } | null;
  readonly kit: readonly {
    readonly key: ContractV1Key;
    readonly skill: string;
    readonly name: string;
    readonly slots: readonly string[];
  }[];
  readonly handheld: {
    readonly default: string;
    readonly byMode: Readonly<Record<string, string>>;
    readonly bone: string;
  } | null;
  readonly slots: readonly string[];
}

export interface CharacterContractV1 {
  readonly schema: CharacterContractV1Schema;
  readonly schemaVersion: 1;
  readonly projectId: 'omoba';
  readonly revision: string;
  readonly previousRevision: string | null;
  readonly license: string;
  readonly source: ContractV1Source;
  readonly package: ContractV1Package;
  readonly rig: ContractV1Rig;
  readonly timing: ContractV1Timing;
  readonly rules: readonly ContractV1Rule[];
  readonly slots: Readonly<Record<string, ContractV1Slot>>;
  readonly heroes: readonly ContractV1Hero[];
}
