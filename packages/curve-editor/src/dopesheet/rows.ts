// Dope Sheet rows (M2A-SPEC §5.10): Summary › Character › Body part (humanoid rigs) › Control › Channel. Only
// controls with at least one keyed curve in the clip get rows; channel rows exist for keyed channels. Every row lists
// the keyed base-layer curves under it.
import type { ChannelId, CharacterId, ClipId, ControlId, ControlRecord, CurveId } from '@ekza-studio/doc';
import {
  type BodyPart,
  bodyPartOf,
  controlVisibility,
  type EditorApp,
  sortChannelsForDisplay,
} from '@ekza-studio/editor-core';
import { channelLabel } from '../channel-tree/colors';
import type { DopeSheetRow, DopeSheetRowKind } from '../types';

/** Generator of humanoid auto-rigs (`RigRecord.generator.name`): body-part groups exist only there (§5.19). */
const HUMANOID_GENERATOR = 'ekza-autorig-humanoid';

/** §5.10 group order: Root, Torso, Head, Arm L, Fingers L, Arm R, Fingers R, Leg L, Leg R, Other. */
const GROUPS: readonly { readonly part: BodyPart | null; readonly label: string }[] = [
  { part: 'root', label: 'Root' },
  { part: 'torso', label: 'Torso' },
  { part: 'head', label: 'Head' },
  { part: 'arm.L', label: 'Arm L' },
  { part: 'fingers.L', label: 'Fingers L' },
  { part: 'arm.R', label: 'Arm R' },
  { part: 'fingers.R', label: 'Fingers R' },
  { part: 'leg.L', label: 'Leg L' },
  { part: 'leg.R', label: 'Leg R' },
  { part: null, label: 'Other' },
];

export const SUMMARY_ROW = 'summary';
export const characterRowId = (character: CharacterId): string => `chr:${character}`;
export const groupRowId = (character: CharacterId, part: BodyPart | null): string =>
  `grp:${character}:${part ?? 'other'}`;
export const channelRowId = (control: ControlId, channel: ChannelId): string => `${control}/${channel}`;

/** Rows expanded unless the user collapsed them: Summary, characters and groups; control rows start collapsed. */
export function expandedByDefault(kind: DopeSheetRowKind): boolean {
  return kind === 'summary' || kind === 'character' || kind === 'group';
}

/**
 * Keyed channels of a control in the clip's base layer, in the Channels panel's row order (§5.1 rule 5, M2A-INT-35:
 * TRS, then attributes in `attrs` order, IK/FK last).
 */
function keyedChannels(
  app: EditorApp,
  clip: ClipId,
  layer: string,
  control: ControlRecord,
): { readonly channel: ChannelId; readonly curve: CurveId }[] {
  const out: { channel: ChannelId; curve: CurveId }[] = [];
  for (const curve of app.store.query.curvesOfControl(clip, control.id)) {
    if (curve.layer !== layer) continue;
    if (app.store.query.keysOfCurve(curve.id).length === 0) continue;
    out.push({ channel: curve.channel, curve: curve.id });
  }
  const order = new Map(
    sortChannelsForDisplay(control, new Set(out.map((entry) => entry.channel))).map((channel, i) => [channel, i]),
  );
  return out.sort((a, b) => (order.get(a.channel) ?? 0) - (order.get(b.channel) ?? 0));
}

export interface RowsOptions {
  readonly clip: ClipId | null;
  readonly controls: readonly ControlId[];
}

/**
 * The rows of the shown `controls` in `clip`; `isExpanded` decides which rows show their children. Controls keep
 * the rig's order (parents first); controls of other characters than the clip's are left out.
 */
export function buildRows(
  app: EditorApp,
  opts: RowsOptions,
  isExpanded: (id: string, kind: DopeSheetRowKind) => boolean,
): DopeSheetRow[] {
  if (opts.clip === null) return [];
  const clip = app.store.get('clips', opts.clip);
  const base = clip === undefined ? undefined : app.store.query.baseLayer(clip.id);
  const rig = clip === undefined ? undefined : app.store.query.rigOfCharacter(clip.character);
  if (clip === undefined || base === undefined || rig === undefined) return [];
  const wanted = new Set(opts.controls);
  const humanoid = rig.generator.name === HUMANOID_GENERATOR;

  interface ControlRows {
    readonly control: ControlRecord;
    readonly channels: readonly { readonly channel: ChannelId; readonly curve: CurveId }[];
    readonly part: BodyPart | null;
  }
  const shown: ControlRows[] = [];
  for (const control of app.store.query.controlsOfRig(rig.id)) {
    if (!wanted.has(control.id)) continue;
    const channels = keyedChannels(app, clip.id, base.id, control);
    if (channels.length === 0) continue;
    shown.push({ control, channels, part: humanoid ? bodyPartOf(app, control.id) : null });
  }
  if (shown.length === 0) return [];

  const all: CurveId[] = shown.flatMap((entry) => entry.channels.map((channel) => channel.curve));
  const rows: DopeSheetRow[] = [];
  const push = (row: Omit<DopeSheetRow, 'expanded'>, hasChildren: boolean): boolean => {
    const expanded = hasChildren && isExpanded(row.id, row.kind);
    rows.push({ ...row, expanded });
    return expanded;
  };
  if (!push({ id: SUMMARY_ROW, kind: 'summary', label: 'Summary', depth: 0, curves: all, dimmed: false }, true)) {
    return rows;
  }
  const character = app.store.get('characters', clip.character);
  const chrId = characterRowId(clip.character);
  if (
    !push(
      { id: chrId, kind: 'character', label: character?.name ?? 'Character', depth: 1, curves: all, dimmed: false },
      true,
    )
  ) {
    return rows;
  }

  const pushControl = (entry: ControlRows, depth: number): void => {
    const { control, channels } = entry;
    const dimmed = controlVisibility(app, control.id) !== 'visible';
    const open = push(
      {
        id: control.id,
        kind: 'control',
        label: control.name,
        depth,
        control: control.id,
        curves: channels.map((channel) => channel.curve),
        dimmed,
      },
      true,
    );
    if (!open) return;
    for (const { channel, curve } of channels) {
      push(
        {
          id: channelRowId(control.id, channel),
          kind: 'channel',
          label: channelLabel(channel, control),
          depth: depth + 1,
          control: control.id,
          channel,
          curves: [curve],
          dimmed,
        },
        false,
      );
    }
  };

  if (!humanoid) {
    for (const entry of shown) pushControl(entry, 2);
    return rows;
  }
  for (const { part, label } of GROUPS) {
    const members = shown.filter((entry) => entry.part === part);
    if (members.length === 0) continue;
    const open = push(
      {
        id: groupRowId(clip.character, part),
        kind: 'group',
        label,
        depth: 2,
        ...(part === null ? {} : { group: part }),
        curves: members.flatMap((entry) => entry.channels.map((channel) => channel.curve)),
        dimmed: false,
      },
      true,
    );
    if (open) for (const entry of members) pushControl(entry, 3);
  }
  return rows;
}

/** §5.10 rows (public API): a row is expanded when `expanded` lists its id. */
export function buildDopeSheetRows(
  app: EditorApp,
  opts: {
    readonly clip: ClipId | null;
    readonly controls: readonly ControlId[];
    readonly expanded: ReadonlySet<string>;
    readonly show: 'selected' | 'character';
  },
): DopeSheetRow[] {
  return buildRows(app, opts, (id) => opts.expanded.has(id));
}

/**
 * The controls the Dope Sheet shows (§5.10 `ds-show`): "Selected" — the selected controls of the active character,
 * or all of its controls when none of them is selected; "Character" — every control of the active character.
 */
export function shownControls(app: EditorApp, show: 'selected' | 'character'): readonly ControlId[] {
  const state = app.session.getState();
  const character = state.activeCharacter;
  const rig = character === null ? undefined : app.store.query.rigOfCharacter(character);
  if (rig === undefined) return [];
  const own = app.store.query.controlsOfRig(rig.id).map((control) => control.id);
  if (show === 'character') return own;
  const mine = new Set(own);
  const selected = state.selection.controls.filter((control) => mine.has(control));
  return selected.length > 0 ? selected : own;
}
