// The slot status function (CHARACTER-CONTRACT-SPEC §8.3, §8.9; decision D12): pure, never stored. For the character
// a target binds, every slot of its game character's view in checklist order with its status — `custom` (a clip
// fills it, through its own slot or an alias), `invalid` (the fill fails an error rule), `default` (empty: the game
// plays its own), `missing` (empty, required, no default), `fixed` (not open in this contract) — plus the clips the
// game will not use (`extras`). Generic over slot kinds: each kind has a filler; `animation` slots are filled by clips
// (`clip.slot === slot id`), an `asset` slot has no filler in C1 and shows its default. The document-level checks of
// §8.9 (C1) read their numbers from the contract (rule parameters, the slot's window and contact): duration window,
// loop flag, frame rate, contact present and within the limit, root motion in place, basic-attack interval. The checks
// on written bytes (channels, samplers, loop closure, hips drift) are C2's.
import type { Fps } from '@ekza-studio/anim-core';
import type { ClipId, ClipRecord } from '@ekza-studio/doc';
import {
  type ContractModel,
  type ContractRuleSeverity,
  type ContractSlotDefault,
  type ContractSlotKind,
  type ContractSlotSpec,
  contractCharacter,
  contractRule,
} from '@ekza-studio/io';

export interface SlotIssue {
  /** The contract rule the check belongs to (`clip.duration`), or a Studio check (`slot.not-open`). */
  readonly rule: string;
  readonly severity: ContractRuleSeverity;
  readonly message: string;
}

export type SlotStatus =
  | {
      readonly kind: 'custom';
      readonly clip: ClipId;
      /** `own`: the clip holds this slot; `alias`: it holds `from` and this slot reuses it (*Same clip as…*). */
      readonly via: 'own' | 'alias';
      readonly from: string;
      readonly issues: readonly SlotIssue[];
    }
  | {
      readonly kind: 'invalid';
      readonly clip: ClipId;
      readonly via: 'own' | 'alias';
      readonly from: string;
      readonly issues: readonly SlotIssue[];
    }
  | { readonly kind: 'default' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'fixed' };

export type SlotStatusKind = SlotStatus['kind'];

export interface SlotRow {
  readonly slot: string;
  readonly label: string;
  readonly kind: ContractSlotKind;
  /** The section it is listed under (Base, Basic attack, a Q/W/E/R skill). */
  readonly section: string;
  readonly key: string | null;
  readonly status: SlotStatus;
  /** "↻ 0.67 s · in place" (the fill), or "game default · 0.30 s · contact 0.13 s". */
  readonly timing: string;
  /** What to aim for: the default's play time and contact (seconds). */
  readonly target: { readonly secs: number; readonly contactSecs: number | null };
  readonly default: ContractSlotDefault | null;
  /** When the slot opens, for a fixed slot ("1.1"). */
  readonly customizableFrom: string | null;
}

export interface SlotStatuses {
  readonly game: string;
  readonly gameCharacter: string;
  readonly revision: string;
  readonly rows: readonly SlotRow[];
  readonly counts: Readonly<Record<SlotStatusKind, number>>;
  /** Clips of the character the game will not use (no slot of the view; left out of the package). */
  readonly extras: readonly ClipId[];
}

/** The clip fields the status reads. */
export type SlotClip = Pick<
  ClipRecord,
  'id' | 'name' | 'slot' | 'fps' | 'range' | 'loop' | 'rootMotion' | 'contact'
> & {
  readonly source?: ClipRecord['source'];
};

export interface SlotBinding {
  readonly gameCharacter: string;
  readonly aliases: Readonly<Record<string, string>>;
}

const fpsOf = (fps: Fps): number => fps.num / fps.den;
/** The clip's length in seconds. */
export const clipSeconds = (clip: SlotClip): number => (clip.range.end - clip.range.start) / fpsOf(clip.fps);
/** The clip's contact in seconds after its start, or null. */
export const contactSeconds = (clip: SlotClip): number | null =>
  clip.contact === null ? null : (clip.contact - clip.range.start) / fpsOf(clip.fps);

const secs = (value: number): string => `${(Math.round(value * 100) / 100).toFixed(2)} s`;
const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** The C1 document checks of an animation fill (§8.9), with the contract's numbers. */
function animationIssues(model: ContractModel, spec: ContractSlotSpec, clip: SlotClip): SlotIssue[] {
  const anim = spec.animation;
  if (anim === null) return [];
  const issues: SlotIssue[] = [];
  const rule = (id: string) => contractRule(model, id);
  const duration = clipSeconds(clip);
  const durationRule = rule('clip.duration');
  if (durationRule !== undefined && (duration < anim.window.minSecs - 1e-6 || duration > anim.window.maxSecs + 1e-6)) {
    issues.push({
      rule: durationRule.id,
      severity: durationRule.severity,
      message: `${secs(duration)} is outside ${secs(anim.window.minSecs).slice(0, -2)}–${secs(anim.window.maxSecs)}`,
    });
  }
  const loopRule = rule('clip.loop-closure');
  if (loopRule !== undefined && anim.loop && !clip.loop) {
    issues.push({ rule: loopRule.id, severity: loopRule.severity, message: 'The game loops it: turn Loop on' });
  } else if (loopRule !== undefined && !anim.loop && clip.loop) {
    issues.push({ rule: loopRule.id, severity: 'warning', message: 'The game plays it once; Loop is ignored' });
  }
  const keysRule = rule('clip.keys');
  const maxHz = num(keysRule?.params['maxSampleRateHz'], Number.POSITIVE_INFINITY);
  if (keysRule !== undefined && fpsOf(clip.fps) > maxHz + 1e-9) {
    issues.push({ rule: keysRule.id, severity: keysRule.severity, message: `More than ${maxHz} frames per second` });
  }
  const contactRule = rule('clip.contact');
  const contact = contactSeconds(clip);
  if (contactRule !== undefined && anim.contact !== null) {
    const tolerance = num(contactRule.params['toleranceSecs'], 0);
    if (contact === null) {
      if (anim.contact.required) {
        issues.push({ rule: contactRule.id, severity: contactRule.severity, message: 'Needs a contact frame' });
      }
    } else if (contact < 0 || contact > duration + 1e-6) {
      issues.push({ rule: contactRule.id, severity: contactRule.severity, message: 'The contact is outside the clip' });
    } else if (anim.contact.maxSecs !== null && contact > anim.contact.maxSecs + tolerance) {
      issues.push({
        rule: contactRule.id,
        severity: contactRule.severity,
        message: `Contact ${secs(contact)} > ${secs(anim.contact.maxSecs)}`,
      });
    }
  }
  const inPlaceRule = rule('clip.in-place');
  if (inPlaceRule !== undefined && anim.inPlace && clip.rootMotion !== 'in-place') {
    // Without the hips curves (checked on the bytes, C2) a travelling clip is only likely: a warning here.
    issues.push({
      rule: inPlaceRule.id,
      severity: 'warning',
      message: 'The game plays it in place: set Root motion to In place',
    });
  }
  const intervalRule = rule('clip.basic-interval');
  if (intervalRule !== undefined && anim.minIntervalSecs !== null && duration > anim.minIntervalSecs + 1e-6) {
    issues.push({
      rule: intervalRule.id,
      severity: intervalRule.severity,
      message: `The next attack cuts it after ${secs(anim.minIntervalSecs)} at full attack speed`,
    });
  }
  return issues;
}

/** The fill of a slot of each kind: its clip and how it got there, or null. */
type Filler = (
  spec: ContractSlotSpec,
  ctx: FillContext,
) => { clip: SlotClip; via: 'own' | 'alias'; from: string } | null;

interface FillContext {
  readonly bySlot: ReadonlyMap<string, SlotClip>;
  readonly aliases: Readonly<Record<string, string>>;
}

const FILLERS: Readonly<Record<ContractSlotKind, Filler>> = {
  animation: (spec, { bySlot, aliases }) => {
    const own = bySlot.get(spec.id);
    if (own !== undefined) return { clip: own, via: 'own', from: spec.id };
    const to = aliases[spec.id];
    const aliased = to === undefined ? undefined : bySlot.get(to);
    return aliased === undefined || to === undefined ? null : { clip: aliased, via: 'alias', from: to };
  },
  // Asset slots (a character's own weapon, …) have no filler yet: they show the game's default.
  asset: () => null,
};

function timingOf(spec: ContractSlotSpec, clip: SlotClip | null): string {
  const anim = spec.animation;
  if (clip !== null && anim !== null) {
    const contact = contactSeconds(clip);
    return [
      `${clip.loop ? '↻ ' : ''}${secs(clipSeconds(clip))}`,
      ...(clip.rootMotion === 'in-place' ? ['in place'] : []),
      ...(contact === null ? [] : [`contact ${secs(contact)}`]),
    ].join(' · ');
  }
  if (spec.default === null) return 'no default';
  return [
    'game default',
    `${spec.default.loop ? '↻ ' : ''}${secs(spec.default.playSecs)}`,
    ...(spec.default.contactSecs === null || spec.default.contactSecs < 0
      ? []
      : [`contact ${secs(spec.default.contactSecs)}`]),
  ].join(' · ');
}

/**
 * The statuses of a binding over a contract and the character's clips (pure). Clips are the character's live clips;
 * a test clip (the range-of-motion clip) never fills a slot and is not an extra. Several clips holding one slot (a
 * merge, or an older build) resolve to the first in the given order.
 */
export function computeSlotStatuses(
  model: ContractModel,
  binding: SlotBinding,
  clips: readonly SlotClip[],
): SlotStatuses {
  const character = contractCharacter(model, binding.gameCharacter);
  const usable = clips.filter((clip) => clip.source?.kind !== 'test');
  const bySlot = new Map<string, SlotClip>();
  for (const clip of usable) if (clip.slot !== null && !bySlot.has(clip.slot)) bySlot.set(clip.slot, clip);
  const counts: Record<SlotStatusKind, number> = { custom: 0, invalid: 0, default: 0, missing: 0, fixed: 0 };
  const rows: SlotRow[] = [];
  const used = new Set<ClipId>();
  for (const section of character?.sections ?? []) {
    for (const id of section.slots) {
      const spec = model.slots[id];
      if (spec === undefined) continue;
      const fill = FILLERS[spec.kind](spec, { bySlot, aliases: binding.aliases });
      let status: SlotStatus;
      if (fill !== null) {
        used.add(fill.clip.id);
        const issues: SlotIssue[] = spec.customizable
          ? spec.kind === 'animation'
            ? animationIssues(model, spec, fill.clip)
            : []
          : [
              {
                rule: 'slot.not-open',
                severity: 'error',
                message:
                  spec.customizableFrom === null
                    ? 'The game does not take a custom fill here'
                    : `Custom fills open with contract ${spec.customizableFrom}`,
              },
            ];
        const base = { clip: fill.clip.id, via: fill.via, from: fill.from, issues };
        status = issues.some((issue) => issue.severity === 'error')
          ? { kind: 'invalid', ...base }
          : { kind: 'custom', ...base };
      } else if (!spec.customizable) {
        status = { kind: 'fixed' };
      } else if (spec.required || spec.default === null) {
        status = { kind: 'missing' };
      } else {
        status = { kind: 'default' };
      }
      counts[status.kind]++;
      const anim = spec.animation;
      rows.push({
        slot: id,
        label: spec.label,
        kind: spec.kind,
        section: section.label,
        key: section.key,
        status,
        timing: timingOf(spec, fill?.clip ?? null),
        target: {
          secs: anim?.window.targetSecs ?? spec.default?.playSecs ?? 0,
          contactSecs: anim?.contact?.targetSecs ?? null,
        },
        default: spec.default,
        customizableFrom: spec.customizableFrom,
      });
    }
  }
  return {
    game: model.game,
    gameCharacter: binding.gameCharacter,
    revision: model.revision,
    rows,
    counts,
    extras: usable.filter((clip) => !used.has(clip.id)).map((clip) => clip.id),
  };
}
