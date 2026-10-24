// Plain channel labels (STUDIO-TOUCH-SPEC §10.1, P14, ST-35; T7): a plain label is only a name. Every value it shows
// is Pro's — the same number, unit and sign as Studio Pro's Channels (the right side is never flipped to read
// "outward"); the Pro channel name is shown in grey next to it ("Side · Rotate Z"). A control role may rename a label
// here, never change a value. `channelChips` picks the two or three dominant channels a selected control shows as
// Echo channel chips.

export type TrsChannel = 'tx' | 'ty' | 'tz' | 'rx' | 'ry' | 'rz' | 'sx' | 'sy' | 'sz';

export interface ChannelLabel {
  /** The plain label (Bend, Twist, Side; Move X…). */
  readonly plain: string;
  /** Pro's Channels name (Rotate X…). */
  readonly pro: string;
  /** The unit shown with the value. */
  readonly unit: '°' | 'm' | '×';
}

/** §10.1's normative table (rotation in degrees, translation in metres, scale as a factor). */
export const CHANNEL_LABELS: Readonly<Record<TrsChannel, ChannelLabel>> = {
  rx: { plain: 'Bend', pro: 'Rotate X', unit: '°' },
  ry: { plain: 'Twist', pro: 'Rotate Y', unit: '°' },
  rz: { plain: 'Side', pro: 'Rotate Z', unit: '°' },
  tx: { plain: 'Move X', pro: 'Translate X', unit: 'm' },
  ty: { plain: 'Move Y', pro: 'Translate Y', unit: 'm' },
  tz: { plain: 'Move Z', pro: 'Translate Z', unit: 'm' },
  sx: { plain: 'Scale X', pro: 'Scale X', unit: '×' },
  sy: { plain: 'Scale Y', pro: 'Scale Y', unit: '×' },
  sz: { plain: 'Scale Z', pro: 'Scale Z', unit: '×' },
};

const RAD = 180 / Math.PI;

/** The shown value of a stored channel value: degrees for rotation (stored in radians), as Pro's Channels shows it. */
export function shownValue(channel: TrsChannel, stored: number): number {
  return channel.startsWith('r') ? stored * RAD : stored;
}

/** The stored value of a shown one (the inverse of `shownValue`). */
export function storedValue(channel: TrsChannel, shown: number): number {
  return channel.startsWith('r') ? shown / RAD : shown;
}

/**
 * The channels a control's Echo chips show (§10.1: the 2–3 dominant ones): the three turns of a control that turns,
 * the three moves of one that only moves (IK goals, the root), else the first three keyable channels.
 */
export function channelChips(keyable: (channel: TrsChannel) => boolean): readonly TrsChannel[] {
  const turns: TrsChannel[] = ['rx', 'ry', 'rz'];
  const moves: TrsChannel[] = ['tx', 'ty', 'tz'];
  const turnable = turns.filter(keyable);
  if (turnable.length > 0) return turnable;
  const movable = moves.filter(keyable);
  if (movable.length > 0) return movable;
  return (['sx', 'sy', 'sz'] as TrsChannel[]).filter(keyable).slice(0, 3);
}
