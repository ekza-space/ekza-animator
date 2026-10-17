// Channel Box (FR-CB-01…04, FR-CB-06, research 09 §4.5): the lead selection's keyable TRS channels with Maya's
// state colours, expression entry applied to every selected control through `channel.setValues`, Tab navigation,
// ↑/↓ nudges, channel-name selection for "Key Selected", and the RMB menu (key selected, reset, lock/unlock).
// Values live in a ChannelReadout outside React: playback commits only the rows whose value changed, at most once
// per animation frame.
import {
  type CharacterId,
  type ControlId,
  type ControlRecord,
  type DocumentStore,
  TRS_CHANNELS,
  type TrsChannel,
} from '@ekza-animator/doc';
import { type ChannelEdit, type ChannelRef, PANEL, type SessionState } from '@ekza-animator/editor-core';
import {
  type JSX,
  memo,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useDocQuery, useSession } from '../../hooks';
import type { PanelProps } from '../types';
import { ExpressionField, type NudgeModifiers } from './kit/fields';
import { sameIds, selectedControls, useStableCallback } from './kit/hooks';
import { LockIcon } from './kit/icons';
import { defaultChannelValue, fromDisplayValue, parseNumericInput, toDisplayValue } from './kit/kernel';
import { useContextMenu } from './kit/menu';
import { runOperator, sameChannelRefs, selectModeOf, setChannelSelection } from './kit/run';
import { EMPTY_STATE, MUTED_TEXT, PANEL_ROOT, ROW_HOVER, ROW_SELECTED } from './kit/styles';
import { ChannelNudge, nudgeStep } from './nudge';
import { type ChannelCell, ChannelReadout, type ReadoutTargets } from './readout';
import { CHANNEL_STATE_STYLE, channelStateTitle, type StateBar } from './states';

const PANEL_KIND = PANEL.channelBox;

export const CHANNEL_LABEL: Readonly<Record<TrsChannel, string>> = {
  tx: 'Translate X',
  ty: 'Translate Y',
  tz: 'Translate Z',
  rx: 'Rotate X',
  ry: 'Rotate Y',
  rz: 'Rotate Z',
  sx: 'Scale X',
  sy: 'Scale Y',
  sz: 'Scale Z',
};

const AXIS = { x: 0, y: 1, z: 2 } as const;

function channelFlag(record: ControlRecord, field: 'keyable' | 'locked', channel: TrsChannel): boolean {
  const group = channel[0] as 't' | 'r' | 's';
  const axis = AXIS[channel[1] as 'x' | 'y' | 'z'];
  return record[field][group][axis];
}

export const isChannelKeyable = (record: ControlRecord, channel: TrsChannel): boolean =>
  channelFlag(record, 'keyable', channel);
export const isChannelLocked = (record: ControlRecord, channel: TrsChannel): boolean =>
  channelFlag(record, 'locked', channel);

const selectChannelRefs = (s: SessionState): readonly ChannelRef[] => s.selection.channels;

interface SelectionView {
  /** Selected control records in selection order (deleted ones dropped); the lead is last. */
  readonly records: readonly ControlRecord[];
  readonly lead: ControlRecord | null;
  readonly character: CharacterId | null;
}

export function ChannelBoxPanel({ app, instanceId }: PanelProps): JSX.Element {
  const selected = useSession(selectedControls, sameIds);
  const channelRefs = useSession(selectChannelRefs, sameChannelRefs);
  const read = useCallback(
    (store: DocumentStore): SelectionView => {
      const records = selected.flatMap((id) => {
        const record = store.get('controls', id);
        return record === undefined ? [] : [record];
      });
      const lead = records.at(-1) ?? null;
      const character = lead === null ? null : (store.get('rigs', lead.rig)?.character ?? null);
      return { records, lead, character };
    },
    [selected],
  );
  const { records, lead, character } = useDocQuery(read, ['controls', 'rigs']);

  const rows = useMemo(
    () => (lead === null ? [] : TRS_CHANNELS.filter((channel) => isChannelKeyable(lead, channel))),
    [lead],
  );
  /** Per shown channel: the selected controls on which it is keyable. */
  const targets = useMemo(
    () =>
      new Map(
        rows.map(
          (channel) =>
            [channel, records.filter((r) => isChannelKeyable(r, channel)).map((r) => r.id)] as [
              TrsChannel,
              ControlId[],
            ],
        ),
      ),
    [rows, records],
  );
  const byId = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);

  const [readout] = useState(() => new ChannelReadout(app));
  const [nudge] = useState(() => new ChannelNudge(app, readout, PANEL_KIND));
  useEffect(() => readout.connect(), [readout]);
  useLayoutEffect(() => {
    const next: ReadoutTargets | null = lead === null ? null : { lead: lead.id, character, channels: targets };
    readout.setTargets(next);
  }, [readout, lead, character, targets]);
  // A new selection (or unmount) ends a running nudge on the old one.
  useEffect(() => () => nudge.end(false), [nudge, selected]);

  /** Channel names selected for the lead (the Graph Editor highlights the same refs). */
  const selectedNames = useMemo(
    () => new Set(channelRefs.filter((ref) => ref.control === lead?.id).map((ref) => ref.channel as TrsChannel)),
    [channelRefs, lead],
  );

  const writeNames = useStableCallback((names: ReadonlySet<TrsChannel>): void => {
    const refs: ChannelRef[] = [];
    for (const channel of rows) {
      if (!names.has(channel)) continue;
      for (const control of targets.get(channel) ?? []) refs.push({ control, channel });
    }
    setChannelSelection(app, refs);
  });

  /** The channels an action on `channel` covers: the selected names when it is one of them. */
  const scopeOf = useStableCallback((channel: TrsChannel): TrsChannel[] =>
    selectedNames.has(channel) ? rows.filter((c) => selectedNames.has(c)) : [channel],
  );

  const commit = useStableCallback((channel: TrsChannel, text: string): string | null => {
    nudge.end(false);
    const channels = scopeOf(channel);
    const edits: ChannelEdit[] = [];
    for (const ch of channels) {
      for (const control of targets.get(ch) ?? []) {
        const current = toDisplayValue(ch, readout.value(control, ch));
        const next = parseNumericInput(text, current);
        if (next === null) return `'${text}' is not a number or expression`;
        edits.push({ control, channel: ch, value: fromDisplayValue(ch, next) });
      }
    }
    if (edits.length === 0) return null;
    const label = channels.length === 1 ? `Set ${CHANNEL_LABEL[channel]}` : `Set ${channels.length} Channels`;
    void runOperator(app, PANEL_KIND, 'channel.setValues', { edits, key: 'auto', label });
    return null;
  });

  const isLocked = (control: ControlId, channel: TrsChannel): boolean => {
    const record = byId.get(control);
    return record !== undefined && isChannelLocked(record, channel);
  };

  const onNudge = useStableCallback((channel: TrsChannel, direction: 1 | -1, modifiers: NudgeModifiers): void => {
    const channels = scopeOf(channel);
    const scope = new Map(channels.map((ch) => [ch, (targets.get(ch) ?? []).filter((id) => !isLocked(id, ch))]));
    const label = channels.length === 1 ? `Nudge ${CHANNEL_LABEL[channel]}` : `Nudge ${channels.length} Channels`;
    nudge.press(scope, direction * nudgeStep(channel, modifiers), label);
  });
  const onNudgeEnd = useStableCallback((cancel: boolean) => nudge.end(cancel));
  /** FR-CB-04: a locked channel rejects edits with a toast (its field is read-only). */
  const onLockedEdit = useStableCallback((channel: TrsChannel): void => {
    app.services.notify.toast({
      kind: 'warning',
      text: `${CHANNEL_LABEL[channel]} is locked. Unlock it from the right-click menu to edit it.`,
    });
  });

  // ---------- focus order (Tab / Shift+Tab cycle through the editable fields) ----------
  const fields = useRef(new Map<TrsChannel, HTMLInputElement>());
  const fieldRef = useStableCallback((channel: TrsChannel, input: HTMLInputElement | null): void => {
    if (input === null) fields.current.delete(channel);
    else fields.current.set(channel, input);
  });
  const onTab = useStableCallback((channel: TrsChannel, backwards: boolean): void => {
    const editable = rows.filter((c) => lead !== null && !isChannelLocked(lead, c));
    if (editable.length === 0) return;
    const at = editable.indexOf(channel);
    const next = editable[(at + (backwards ? -1 : 1) + editable.length) % editable.length];
    if (next !== undefined) fields.current.get(next)?.focus();
  });

  // ---------- channel-name selection: click with modifiers, drag down the names for a range ----------
  const drag = useRef<{ readonly anchor: TrsChannel; readonly base: ReadonlySet<TrsChannel> } | null>(null);
  useEffect(() => {
    const stop = (): void => {
      drag.current = null;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);
  const onNamePointerDown = useStableCallback((channel: TrsChannel, event: PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    const mode = selectModeOf(app, event);
    const names = new Set(mode === 'replace' ? [] : selectedNames);
    if (mode === 'replace' || mode === 'add') names.add(channel);
    else if (mode === 'remove') names.delete(channel);
    else if (names.has(channel)) names.delete(channel);
    else names.add(channel);
    drag.current =
      mode === 'remove' ? null : { anchor: channel, base: new Set(mode === 'replace' ? [] : selectedNames) };
    writeNames(names);
  });
  const onNamePointerEnter = useStableCallback((channel: TrsChannel, event: PointerEvent<HTMLElement>): void => {
    const state = drag.current;
    if (state === null || (event.buttons & 1) === 0) return;
    const from = rows.indexOf(state.anchor);
    const to = rows.indexOf(channel);
    const names = new Set(state.base);
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
      const c = rows[i];
      if (c !== undefined) names.add(c);
    }
    writeNames(names);
  });

  // ---------- RMB menu ----------
  const menu = useContextMenu();
  const onMenu = useStableCallback((channel: TrsChannel, event: MouseEvent): void => {
    nudge.end(false);
    const channels = scopeOf(channel);
    if (!selectedNames.has(channel)) writeNames(new Set([channel]));
    const refs = channels.flatMap((ch) => (targets.get(ch) ?? []).map((control) => ({ control, channel: ch })));
    const allLocked = refs.length > 0 && refs.every((ref) => isLocked(ref.control, ref.channel));
    menu.open(event, 'Channels', [
      {
        kind: 'item',
        id: 'key',
        label: 'Key Selected',
        testId: 'cb-menu-key-selected',
        onSelect: () => void runOperator(app, PANEL_KIND, 'key.set', { channels: 'selected' }),
      },
      {
        kind: 'item',
        id: 'reset',
        label: 'Reset to Default',
        testId: 'cb-menu-reset',
        onSelect: () =>
          void runOperator(app, PANEL_KIND, 'channel.setValues', {
            edits: refs.map((ref) => ({ ...ref, value: defaultChannelValue(ref.channel) })),
            key: 'auto',
            label: 'Reset to Default',
          }),
      },
      {
        kind: 'item',
        id: 'lock',
        label: allLocked ? 'Unlock Selected' : 'Lock Selected',
        testId: 'cb-menu-lock',
        onSelect: () => void runOperator(app, PANEL_KIND, 'channel.toggleLock', { refs, locked: !allLocked }),
      },
    ]);
  });

  if (lead === null) {
    return (
      <div className={PANEL_ROOT} data-testid="channel-box-panel" data-instance={instanceId}>
        <div className={EMPTY_STATE} data-testid="cb-empty">
          Select a control to see its channels.
        </div>
      </div>
    );
  }

  const others = records.length - 1;
  return (
    <div className={PANEL_ROOT} data-testid="channel-box-panel" data-instance={instanceId}>
      <header className="flex h-7 shrink-0 items-center gap-2 border-b border-line bg-header px-2">
        <span className="truncate font-semibold" title={lead.key} data-testid="cb-lead-name">
          {lead.name}
        </span>
        {others > 0 ? (
          <span className={MUTED_TEXT} title={`${others} more selected: edits apply to all`} data-testid="cb-more">
            +{others}
          </span>
        ) : null}
        <span
          className={`ml-auto shrink-0 ${MUTED_TEXT}`}
          title="Rotate order (first letter applied first). Read-only until the pose-preserving change lands."
          data-testid="cb-rotate-order"
        >
          Rotate order <span className="font-mono text-fg-2">{lead.rotateOrder}</span>
        </span>
      </header>
      {rows.length === 0 ? (
        <div className={EMPTY_STATE} data-testid="cb-no-channels">
          {lead.name} has no keyable channels.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto py-1">
          <table
            className="w-full table-fixed border-separate border-spacing-x-1.5 border-spacing-y-0"
            aria-label={`Channels of ${lead.name}`}
          >
            <colgroup>
              <col />
              <col className="w-[7.5rem]" />
            </colgroup>
            <tbody>
              {rows.map((channel) => (
                <ChannelRow
                  key={channel}
                  readout={readout}
                  channel={channel}
                  nameSelected={selectedNames.has(channel)}
                  locked={isChannelLocked(lead, channel)}
                  fieldRef={fieldRef}
                  onCommit={commit}
                  onNudge={onNudge}
                  onNudgeEnd={onNudgeEnd}
                  onTab={onTab}
                  onLockedEdit={onLockedEdit}
                  onNamePointerDown={onNamePointerDown}
                  onNamePointerEnter={onNamePointerEnter}
                  onMenu={onMenu}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {menu.element}
    </div>
  );
}

interface ChannelRowProps {
  readonly readout: ChannelReadout;
  readonly channel: TrsChannel;
  readonly nameSelected: boolean;
  readonly locked: boolean;
  readonly fieldRef: (channel: TrsChannel, input: HTMLInputElement | null) => void;
  readonly onCommit: (channel: TrsChannel, text: string) => string | null;
  readonly onNudge: (channel: TrsChannel, direction: 1 | -1, modifiers: NudgeModifiers) => void;
  readonly onNudgeEnd: (cancel: boolean) => void;
  readonly onTab: (channel: TrsChannel, backwards: boolean) => void;
  readonly onLockedEdit: (channel: TrsChannel) => void;
  readonly onNamePointerDown: (channel: TrsChannel, event: PointerEvent<HTMLElement>) => void;
  readonly onNamePointerEnter: (channel: TrsChannel, event: PointerEvent<HTMLElement>) => void;
  readonly onMenu: (channel: TrsChannel, event: MouseEvent) => void;
}

const NO_CELL: ChannelCell = { text: '', mixed: false, state: 'static', clipFrame: null, pending: false };

/** One channel; subscribes to its own readout cell, so a value change re-renders this row only. */
const ChannelRow = memo(function ChannelRow(props: ChannelRowProps): JSX.Element {
  const { readout, channel, locked } = props;
  const getCell = useCallback(() => readout.cell(channel) ?? NO_CELL, [readout, channel]);
  const cell = useSyncExternalStore(readout.subscribe, getCell, getCell);
  const style = CHANNEL_STATE_STYLE[cell.state];
  const title = channelStateTitle(cell.state, cell.clipFrame);
  const label = CHANNEL_LABEL[channel];
  return (
    <tr
      className="h-[22px]"
      data-channel={channel}
      data-state={cell.state}
      onContextMenu={(event) => props.onMenu(channel, event)}
    >
      <th scope="row" className="min-w-0 p-0 font-normal">
        <button
          type="button"
          tabIndex={-1}
          className={`block h-[20px] w-full truncate rounded-[3px] px-1 text-right text-fg-2 ${
            props.nameSelected ? `${ROW_SELECTED} text-fg` : ROW_HOVER
          }`}
          aria-pressed={props.nameSelected}
          title={`${label}: click to select (Shift toggle, drag for a range); RMB for keying and locks`}
          data-testid={`cb-name-${channel}`}
          onPointerDown={(event) => props.onNamePointerDown(channel, event)}
          onPointerEnter={(event) => props.onNamePointerEnter(channel, event)}
        >
          {label}
        </button>
      </th>
      <td className="relative p-0">
        <StateCue bar={style.bar} />
        <ExpressionField
          bindInput={(input) => props.fieldRef(channel, input)}
          text={cell.text}
          readOnly={locked}
          ariaLabel={label}
          title={`${title}${cell.mixed ? ' · values differ between the selected controls' : ''}`}
          testId={`cb-field-${channel}`}
          className={`w-full pl-2.5 text-right tabular-nums ${cell.mixed ? 'italic' : ''} ${cell.pending ? 'underline decoration-dotted' : ''}`}
          style={{ background: style.fill, color: style.text }}
          onCommit={(text) => props.onCommit(channel, text)}
          onNudge={(direction, modifiers) => props.onNudge(channel, direction, modifiers)}
          onNudgeEnd={props.onNudgeEnd}
          onTab={(backwards) => props.onTab(channel, backwards)}
          onRejectedEdit={locked ? () => props.onLockedEdit(channel) : undefined}
        />
      </td>
    </tr>
  );
});

/** The non-colour cue of a state (research 09 §4.5): ▐ solid key on frame, ▏ thin keyed, ┆ dashed changed, lock. */
function StateCue(props: { readonly bar: StateBar }): JSX.Element | null {
  switch (props.bar) {
    case 'solid':
      return (
        <span
          aria-hidden="true"
          data-cue="solid"
          className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 w-[3px] rounded-sm bg-current text-white"
        />
      );
    case 'thin':
      return (
        <span
          aria-hidden="true"
          data-cue="thin"
          className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 w-px bg-[#f3d6db]"
        />
      );
    case 'dashed':
      return (
        <span
          aria-hidden="true"
          data-cue="dashed"
          className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 border-l-[3px] border-dashed border-[#1b1c1f]"
        />
      );
    case 'lock':
      return (
        <span
          aria-hidden="true"
          data-cue="lock"
          className="pointer-events-none absolute top-1 left-0.5 scale-75 text-[#a3a8b2]"
        >
          <LockIcon />
        </span>
      );
    case 'none':
      return null;
  }
}
