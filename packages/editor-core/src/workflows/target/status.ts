// The slot status function (CHARACTER-CONTRACT-SPEC §8.3, §8.9; GAME-PROTOCOL-SPEC §4.4–§4.7; decision D12): pure,
// never stored. For the character a binding names, every slot of its contract target in checklist order (sections may
// mix kinds) with its status — `custom` (filled, through its own slot or an alias), `invalid` (the fill fails an error
// rule), `default` (empty: the game plays or shows its own), `missing` (empty, required, no default), `fixed` (not open
// to packages in this contract: made by the game, or opening in a later minor) — the counts in total and per offer of
// the target, the namespaced rules this Studio defers to the game, and the clips the game will not use (`extras`).
// Generic over slot kinds: each kind has a filler; `animation` slots are filled by clips (`clip.slot === slot id`),
// `asset` and `socket` slots have no filler before GP6 and show their default. The document checks of §8.9 (C1) read
// their numbers from the contract (rule parameters, the slot's window and markers): duration window, loop flag, frame
// rate, markers present and within their limit, root motion in place, minimum interval. C2: every named marker the slot
// declares (the contact on the clip, the others in `ekza.clipMarkers`), and the one-tap fix of each issue that has one
// (*Make loop*, *Set in place*, *Fit timing*, *Set contact*, *Use default*: `target.fix`). The checks on written bytes
// (channels, samplers, loop closure, hips drift) run on the package (io `checkCharacterPackage`).
import type { Fps } from '@ekza-studio/anim-core';
import type { ClipId, ClipRecord } from '@ekza-studio/doc';
import {
  type ContractModel,
  type ContractOffer,
  type ContractRuleSeverity,
  type ContractSlotDefault,
  type ContractSlotKind,
  type ContractSlotSpec,
  type ContractStage,
  contractRule,
  contractTarget,
} from '@ekza-studio/io';

export interface SlotIssue {
  /** The contract rule the check belongs to (`clip.duration`), or a Studio check (`slot.not-open`). */
  readonly rule: string;
  readonly severity: ContractRuleSeverity;
  readonly message: string;
  /** The one-tap fix (`target.fix {character, slot, rule, marker?}`): its button label, or absent. */
  readonly fix?: string;
  /** The marker a `clip.markers` issue is about. */
  readonly marker?: string;
}

/** The fix label of each rule `target.fix` repairs (CHARACTER-CONTRACT-SPEC §8.9). */
export const FIX_LABELS: Readonly<Record<string, string>> = {
  'clip.loop-closure': 'Make loop',
  'clip.in-place': 'Set in place',
  'clip.duration': 'Fit timing',
  'clip.markers': 'Set contact',
  'slot.not-open': 'Use default',
};

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
export type SlotCounts = Readonly<Record<SlotStatusKind, number>>;

export interface SlotRow {
  readonly slot: string;
  readonly label: string;
  readonly kind: ContractSlotKind;
  /** The section it is listed under (Base, Basic attack, a Q/W/E/R skill, Gear). */
  readonly section: string;
  readonly key: string | null;
  readonly status: SlotStatus;
  /** "↻ 0.67 s · in place" (the fill), "game default · 0.30 s · contact 0.13 s", "made by the game". */
  readonly timing: string;
  /** What to aim for (animation slots): the default's play time and marker times (seconds). */
  readonly target: { readonly secs: number | null; readonly markers: Readonly<Record<string, number | null>> };
  readonly default: ContractSlotDefault | null;
  /** When a fixed slot opens ("1.1"), or null (made by the game). */
  readonly customizableFrom: string | null;
  /** The requirement ids of the target's offers that list the slot. */
  readonly offers: readonly string[];
}

export interface OfferStatus {
  readonly package: ContractOffer['package'];
  readonly requirementId: string;
  readonly label: string;
  readonly counts: SlotCounts;
}

export interface SlotStatuses {
  readonly game: string;
  readonly target: string;
  readonly revision: string;
  readonly rows: readonly SlotRow[];
  readonly counts: SlotCounts;
  readonly offers: readonly OfferStatus[];
  /** Namespaced rules this Studio does not check: "checked by the game when you submit" (§7.3). */
  readonly deferred: readonly { readonly rule: string; readonly checkedBy: readonly ContractStage[] }[];
  /** Clips of the character the game will not use (no slot of the target; left out of the package). */
  readonly extras: readonly ClipId[];
}

/** The clip fields the status reads. */
export type SlotClip = Pick<
  ClipRecord,
  'id' | 'name' | 'slot' | 'fps' | 'range' | 'loop' | 'rootMotion' | 'contact'
> & {
  readonly source?: ClipRecord['source'];
  /** Named markers other than the contact, in clip frames (`ekza.clipMarkers`). */
  readonly markers?: Readonly<Record<string, number>>;
};

export interface SlotBinding {
  /** The contract target id (`wildspark`, `any`). */
  readonly target: string;
  readonly aliases: Readonly<Record<string, string>>;
}

const fpsOf = (fps: Fps): number => fps.num / fps.den;
/** The clip's length in seconds. */
export const clipSeconds = (clip: SlotClip): number => (clip.range.end - clip.range.start) / fpsOf(clip.fps);
/** The clip's contact in seconds after its start, or null. */
export const contactSeconds = (clip: SlotClip): number | null =>
  clip.contact === null ? null : (clip.contact - clip.range.start) / fpsOf(clip.fps);
/** A marker of the clip in seconds after its start (`contact` or a named one), or null. */
export function markerSeconds(clip: SlotClip, name: string): number | null {
  if (name === 'contact') return contactSeconds(clip);
  const frame = clip.markers?.[name];
  return frame === undefined ? null : (frame - clip.range.start) / fpsOf(clip.fps);
}

const secs = (value: number): string => `${(Math.round(value * 100) / 100).toFixed(2)} s`;
const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const zero = (): Record<SlotStatusKind, number> => ({ custom: 0, invalid: 0, default: 0, missing: 0, fixed: 0 });

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
      fix: FIX_LABELS['clip.duration'] as string,
    });
  }
  const loopRule = rule('clip.loop-closure');
  if (loopRule !== undefined && anim.loop && !clip.loop) {
    issues.push({
      rule: loopRule.id,
      severity: loopRule.severity,
      message: 'The game loops it: turn Loop on',
      fix: FIX_LABELS['clip.loop-closure'] as string,
    });
  } else if (loopRule !== undefined && !anim.loop && clip.loop) {
    issues.push({ rule: loopRule.id, severity: 'warning', message: 'The game plays it once; Loop is ignored' });
  }
  const keysRule = rule('clip.keys');
  const maxHz = num(keysRule?.params['maxSampleRateHz'], Number.POSITIVE_INFINITY);
  if (keysRule !== undefined && fpsOf(clip.fps) > maxHz + 1e-9) {
    issues.push({ rule: keysRule.id, severity: keysRule.severity, message: `More than ${maxHz} frames per second` });
  }
  const markersRule = rule('clip.markers');
  if (markersRule !== undefined) {
    const tolerance = num(markersRule.params['toleranceSecs'], 0);
    for (const [name, marker] of Object.entries(anim.markers)) {
      const at = markerSeconds(clip, name);
      const label = name === 'contact' ? 'contact' : `${name.replace(/_/g, ' ')} marker`;
      const fix = name === 'contact' ? (FIX_LABELS['clip.markers'] as string) : `Set ${label}`;
      if (at === null) {
        if (marker.required) {
          issues.push({
            rule: markersRule.id,
            severity: markersRule.severity,
            message: `Needs a ${label} frame`,
            fix,
            marker: name,
          });
        }
      } else if (at < 0 || at > duration + 1e-6) {
        issues.push({
          rule: markersRule.id,
          severity: markersRule.severity,
          message: `The ${label} is outside the clip`,
          fix,
          marker: name,
        });
      } else if (marker.maxSecs !== null && at > marker.maxSecs + tolerance) {
        issues.push({
          rule: markersRule.id,
          severity: markersRule.severity,
          message: `${name === 'contact' ? 'Contact' : `The ${label}`} ${secs(at)} > ${secs(marker.maxSecs)}`,
          fix,
          marker: name,
        });
      }
    }
  }
  const inPlaceRule = rule('clip.in-place');
  if (inPlaceRule !== undefined && anim.inPlace && clip.rootMotion !== 'in-place') {
    // Without the hips curves (checked on the bytes, C2) a travelling clip is only likely: a warning here.
    issues.push({
      rule: inPlaceRule.id,
      severity: 'warning',
      message: 'The game plays it in place: set Root motion to In place',
      fix: FIX_LABELS['clip.in-place'] as string,
    });
  }
  const intervalRule = rule('clip.min-interval');
  if (intervalRule !== undefined && anim.minIntervalSecs !== null && duration > anim.minIntervalSecs + 1e-6) {
    issues.push({
      rule: intervalRule.id,
      severity: intervalRule.severity,
      message: `The next action cuts it after ${secs(anim.minIntervalSecs)}`,
    });
  }
  return issues;
}

interface FillContext {
  readonly bySlot: ReadonlyMap<string, SlotClip>;
  readonly aliases: Readonly<Record<string, string>>;
}

/** The fill of a slot: its clip and how it got there, or null. */
type Filler = (
  spec: ContractSlotSpec,
  ctx: FillContext,
) => { clip: SlotClip; via: 'own' | 'alias'; from: string } | null;

const FILLERS: Readonly<Record<ContractSlotKind, Filler>> = {
  animation: (spec, { bySlot, aliases }) => {
    const own = bySlot.get(spec.id);
    if (own !== undefined) return { clip: own, via: 'own', from: spec.id };
    const to = aliases[spec.id];
    const aliased = to === undefined ? undefined : bySlot.get(to);
    return aliased === undefined || to === undefined ? null : { clip: aliased, via: 'alias', from: to };
  },
  // Asset and socket slots have no filler before GP6: they show the game's default.
  asset: () => null,
  socket: () => null,
};

function timingOf(spec: ContractSlotSpec, status: SlotStatus, clip: SlotClip | null): string {
  if (clip !== null && spec.animation !== null) {
    const contact = contactSeconds(clip);
    return [
      `${clip.loop ? '↻ ' : ''}${secs(clipSeconds(clip))}`,
      ...(clip.rootMotion === 'in-place' ? ['in place'] : []),
      ...(contact === null ? [] : [`contact ${secs(contact)}`]),
    ].join(' · ');
  }
  if (status.kind === 'fixed') {
    return spec.customizableFrom === null ? 'made by the game' : `game default · opens with ${spec.customizableFrom}`;
  }
  if (spec.default === null) return 'no default';
  const contact = spec.default.markers['contact'];
  return [
    'game default',
    ...(spec.default.playSecs === null
      ? []
      : [`${spec.default.loop === true ? '↻ ' : ''}${secs(spec.default.playSecs)}`]),
    ...(contact === undefined ? [] : [`contact ${secs(contact)}`]),
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
  const target = contractTarget(model, binding.target);
  const usable = clips.filter((clip) => clip.source?.kind !== 'test');
  const bySlot = new Map<string, SlotClip>();
  for (const clip of usable) if (clip.slot !== null && !bySlot.has(clip.slot)) bySlot.set(clip.slot, clip);
  const counts = zero();
  const rows: SlotRow[] = [];
  const used = new Set<ClipId>();
  const placed = new Set<string>();
  const sections = [
    ...(target?.sections ?? []),
    // a slot of the target no section lists still shows, last
    { id: 'other', label: 'Other', key: null, slots: target?.slots ?? [] },
  ];
  for (const section of sections) {
    for (const id of section.slots) {
      const spec = model.slots[id];
      if (spec === undefined || placed.has(id)) continue;
      placed.add(id);
      const fill = FILLERS[spec.kind](spec, { bySlot, aliases: binding.aliases });
      let status: SlotStatus;
      if (fill !== null) {
        used.add(fill.clip.id);
        const issues: SlotIssue[] = spec.customizable
          ? animationIssues(model, spec, fill.clip)
          : [
              {
                rule: 'slot.not-open',
                severity: 'error',
                message:
                  spec.customizableFrom === null
                    ? 'The game makes this one itself'
                    : `Custom fills open with contract ${spec.customizableFrom}`,
                fix: FIX_LABELS['slot.not-open'] as string,
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
      const markers: Record<string, number | null> = {};
      for (const [name, marker] of Object.entries(spec.animation?.markers ?? {})) markers[name] = marker.targetSecs;
      rows.push({
        slot: id,
        label: spec.label,
        kind: spec.kind,
        section: section.label,
        key: section.key,
        status,
        timing: timingOf(spec, status, fill?.clip ?? null),
        target: { secs: spec.animation?.window.targetSecs ?? spec.default?.playSecs ?? null, markers },
        default: spec.default,
        customizableFrom: spec.customizableFrom,
        offers: (target?.accepts ?? []).filter((offer) => offer.slots.includes(id)).map((offer) => offer.requirementId),
      });
    }
  }
  const offers = (target?.accepts ?? []).map((offer) => {
    const offerCounts = zero();
    for (const row of rows) if (offer.slots.includes(row.slot)) offerCounts[row.status.kind]++;
    return { package: offer.package, requirementId: offer.requirementId, label: offer.label, counts: offerCounts };
  });
  return {
    game: model.game,
    target: binding.target,
    revision: model.revision,
    rows,
    counts,
    offers,
    deferred: model.rules.filter((rule) => rule.deferred).map((rule) => ({ rule: rule.id, checkedBy: rule.checkedBy })),
    extras: usable.filter((clip) => !used.has(clip.id)).map((clip) => clip.id),
  };
}
