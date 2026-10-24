// The game-agnostic contract model (CHARACTER-CONTRACT-SPEC §3, §8; C1). A game publishes a contract: per character
// (a "view": a hero class, or "any character") the ordered slots a creator may fill, each slot of one kind —
// `animation` today, `asset` (a character's own weapon, grenade, …) later — with the game's default and the rules a
// custom fill must pass. Studio's target binding, slot statuses and checklists read only this model; each contract
// document format is a *profile* (`./profiles/*`) that parses its own document strictly and maps it here. Names stay
// neutral: the first profile is OMOBA's `omoba.character-contract.v1`.

/** The kind of thing a slot holds. `asset` is reserved for asset slots (no profile emits it yet). */
export type ContractSlotKind = 'animation' | 'asset';

export type ContractRuleSeverity = 'error' | 'warning';

/** One rule of the contract's table: the id names logic each implementation has; parameters are data. */
export interface ContractRuleSpec {
  readonly id: string;
  readonly severity: ContractRuleSeverity;
  readonly scope: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** What an animation slot needs (seconds; a custom clip plays as authored). */
export interface AnimationSlotSpec {
  /** The clip must loop (`loop` slots) or plays once (`action`, `hold`). */
  readonly loop: boolean;
  /** How the game plays it: `loop`, `action` (once), `hold` (once, then holds the last pose). */
  readonly playback: 'loop' | 'action' | 'hold';
  /** The hips may not travel. */
  readonly inPlace: boolean;
  readonly window: { readonly minSecs: number; readonly targetSecs: number; readonly maxSecs: number };
  /** The impact pose: required or not, its latest time after the start (null: no limit) and the default's time. */
  readonly contact: {
    readonly required: boolean;
    readonly maxSecs: number | null;
    readonly targetSecs: number | null;
  } | null;
  /** A clip longer than this is cut by the next action at the fastest rate (basic attacks). */
  readonly minIntervalSecs: number | null;
  /** The game's own wind-up before the clip starts (seconds), or null. */
  readonly telegraphSecs: number | null;
}

/** The game's default for a slot: what plays when the package leaves the slot empty. */
export interface ContractSlotDefault {
  /** The game's name for its default (a motion id). */
  readonly name: string;
  /** How long the default plays, and when its contact comes (seconds), as the game plays it. */
  readonly playSecs: number;
  readonly contactSecs: number | null;
  readonly loop: boolean;
}

export interface ContractSlotSpec {
  readonly id: string;
  readonly kind: ContractSlotKind;
  readonly label: string;
  /** May a package fill it under this contract? (false: shown as a fixed default). */
  readonly customizable: boolean;
  /** The contract version that opens a fixed slot (`"1.1"`), or null. */
  readonly customizableFrom: string | null;
  /** Exists for a future game state; never played. */
  readonly reserved: boolean;
  /** A package must fill it (no default to fall back to). */
  readonly required: boolean;
  readonly default: ContractSlotDefault | null;
  readonly animation: AnimationSlotSpec | null;
  /** Slots whose default is the same (one custom fill may serve all), and the other half of an alternating pair. */
  readonly sharesDefaultWith: readonly string[];
  readonly alternatesWith: readonly string[];
}

/** A labelled group of a character's slots in checklist order (Base, Basic attack, Q …). */
export interface ContractSection {
  readonly id: string;
  readonly label: string;
  /** The input key shown with it (`Q`), or null. */
  readonly key: string | null;
  readonly slots: readonly string[];
}

/** One character of the game a creator can target (a hero class, or `any`). */
export interface ContractCharacter {
  readonly id: string;
  readonly name: string;
  /** `any`: a character for every hero (base slots only). */
  readonly kind: 'character' | 'any';
  readonly subtitle: string | null;
  /** The requirement a submission names on Hub (`character.<id>`). */
  readonly requirementId: string;
  readonly sections: readonly ContractSection[];
  /** Every slot of the character, in checklist order. */
  readonly slots: readonly string[];
}

/** A parsed, verified contract as Studio reads it, whatever its profile. */
export interface ContractModel {
  /** The game (Hub project id): `omoba`. */
  readonly game: string;
  readonly gameName: string;
  /** The document's own schema id (the profile): `omoba.character-contract.v1`. */
  readonly schema: string;
  readonly revision: string;
  readonly previousRevision: string | null;
  readonly license: string;
  readonly characters: readonly ContractCharacter[];
  readonly slots: Readonly<Record<string, ContractSlotSpec>>;
  readonly rules: readonly ContractRuleSpec[];
}

/** The character `id` of a contract, or undefined. */
export function contractCharacter(model: ContractModel, id: string): ContractCharacter | undefined {
  return model.characters.find((character) => character.id === id);
}

/** The rule `id` of a contract, or undefined (a rule the contract does not list is not checked). */
export function contractRule(model: ContractModel, id: string): ContractRuleSpec | undefined {
  return model.rules.find((rule) => rule.id === id);
}
