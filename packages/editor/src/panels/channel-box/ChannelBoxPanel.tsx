// Channel Box (FR-CB-01…06, research 09 §4.5): the lead selection's keyable channels with Maya's state colours,
// expression entry applied to every selected control through `channel.setValues`, Tab navigation, ↑/↓ nudges,
// channel-name selection for "Key Selected", the RMB menu (key selected, reset, lock/unlock) and the virtual slider.
// Values live in a ChannelReadout outside React: playback commits only the rows whose value changed, at most once
// per animation frame.
//
// M2a (M2A-SPEC §5.1 rule 5, §5.6, §5.18; A2): attribute rows after the TRS rows in `attrs` order, labelled and shown
// in their unit (an angle attribute in degrees: `30` on Roll is 30°); the IK/FK proxy row (`cb-ikfk-row`) for any
// control of a limb, editing the limb IK control's `@ikFk` (its raw row is hidden), with a switch button; the
// virtual slider on a MMB press on any row, or an LMB drag of ≥ 3 px horizontally that starts on a channel name.
import type { CharacterId, ChannelId, ControlId, ControlRecord, DocumentStore } from '@ekza-animator/doc';
import { TRS_CHANNELS, type TrsChannel } from '@ekza-animator/doc';
import {
  attrChannelsOf,
  type ChannelEdit,
  type ChannelRef,
  channelDefaultOf,
  channelDisplayLabel,
  channelUnit,
  type EditorApp,
  isKeyable,
  isLocked as isChannelLockedOn,
  LIMB_NAME,
  limbOfControlApp,
  PANEL,
  type SceneObjectId,
  type SessionState,
  sortChannelsForDisplay,
} from '@ekza-animator/editor-core';
import type { LimbDesc } from '@ekza-animator/rig';
import { startVirtualSliderDrag, type VirtualSliderDrag } from '@ekza-animator/viewport';
import {
  type JSX,
  lazy,
  memo,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  Suspense,
  useState,
  useSyncExternalStore,
} from 'react';
import { useDocQuery, useSession } from '../../hooks';
import { useOptionalShell } from '../../shell/context';
import type { PanelProps } from '../types';
import { ExpressionField, type NudgeModifiers } from './kit/fields';
import { sameIds, selectedControls, useCharactersVersion, useStableCallback } from './kit/hooks';
import { LockIcon } from './kit/icons';
import { fromDisplayValue, parseNumericInput, toDisplayValue } from './kit/kernel';
import { useContextMenu } from './kit/menu';
import { runOperator, sameChannelRefs, selectModeOf, setChannelSelection } from './kit/run';
import { BUTTON, EMPTY_STATE, MUTED_TEXT, PANEL_ROOT, ROW_HOVER, ROW_SELECTED } from './kit/styles';
import { ChannelNudge, nudgeStep } from './nudge';
import { type ChannelCell, ChannelReadout, PROXY_CELL, type ReadoutTargets } from './readout';
import { CHANNEL_STATE_STYLE, channelStateTitle, type StateBar } from './states';

const PANEL_KIND = PANEL.channelBox;

// M6a (M6A-SPEC §8.6; B11): a mesh or group object's rows and INPUTS in Model, a lazy chunk.
const MeshChannels = lazy(() => import('./MeshChannels'));

/** The mesh or group object whose channels the Channel Box shows in Model (the lead object, else the hilite lead). */
export function modelLeadObject(s: SessionState): SceneObjectId | null {
  if (s.workspace !== 'model') return null;
  const isObject = (id: string): boolean => id.startsWith('msh_') || id.startsWith('grp_');
  const lead = s.selection.objects.at(-1);
  if (lead !== undefined && isObject(lead)) return lead;
  if (s.model.componentMode === 'object') return null;
  return s.model.hilite.at(-1) ?? null;
}

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

/** A row key: a channel id ('rx', '@roll') or the IK/FK proxy row. */
type RowKey = ChannelId | typeof PROXY_CELL;

/** Pixels of horizontal LMB motion on a channel name that start the virtual slider (§5.18). */
const LMB_SLIDER_PX = 3;

const selectChannelRefs = (s: SessionState): readonly ChannelRef[] => s.selection.channels;

interface SelectionView {
  /** Selected control records in selection order (deleted ones dropped); the lead is last. */
  readonly records: readonly ControlRecord[];
  readonly lead: ControlRecord | null;
  readonly character: CharacterId | null;
}

/**
 * Label of a channel row: TRS names, `AttrDef.label` or the title-cased attribute name — `channelDisplayLabel`, which
 * the Graph Editor and the Dope Sheet use too (M2A-INT-35).
 */
export function channelRowLabel(record: ControlRecord | null, channel: ChannelId): string {
  return channelDisplayLabel(record, channel);
}

/** The lead's limb for the IK/FK proxy row (§5.6): any FK chain control, IK control or pole of a limb. */
function useLimbOf(app: EditorApp, control: ControlId | null): LimbDesc | null {
  const version = useCharactersVersion(app);
  return useMemo(() => {
    void version; // recompiled programs carry new limbs
    return control === null ? null : limbOfControlApp(app, control);
  }, [app, control, version]);
}

export function ChannelBoxPanel({ app, instanceId }: PanelProps): JSX.Element {
  const shell = useOptionalShell();
  const pointerLock = shell?.params.pointerLock ?? true;
  const selected = useSession(selectedControls, sameIds);
  const modelLead = useSession(modelLeadObject);
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
  const limb = useLimbOf(app, lead?.id ?? null);
  const ikControl = limb?.params.ikControl ?? null;

  /**
   * TRS rows, then attribute rows (§5.1 rule 5) in the order every channel list shares (`sortChannelsForDisplay`);
   * the IK control's raw @ikFk row is hidden (the proxy shows it, as the last row).
   */
  const rows = useMemo((): readonly ChannelId[] => {
    if (lead === null) return [];
    const trs = TRS_CHANNELS.filter((channel) => isChannelKeyable(lead, channel));
    const attrs = attrChannelsOf(lead).filter(
      (channel) => isKeyable(lead, channel) && !(channel === '@ikFk' && lead.id === ikControl),
    );
    return sortChannelsForDisplay(lead, [...trs, ...attrs]);
  }, [lead, ikControl]);
  /** Per shown channel: the selected controls on which it is keyable. */
  const targets = useMemo(
    () =>
      new Map(
        rows.map(
          (channel) =>
            [channel, records.filter((r) => isKeyable(r, channel)).map((r) => r.id)] as [ChannelId, ControlId[]],
        ),
      ),
    [rows, records],
  );
  const byId = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);
  const proxyRef = useMemo(
    (): ChannelRef | null => (ikControl === null ? null : { control: ikControl, channel: '@ikFk' }),
    [ikControl],
  );

  const [readout] = useState(() => new ChannelReadout(app));
  const [nudge] = useState(() => new ChannelNudge(app, readout, PANEL_KIND));
  useEffect(() => readout.connect(), [readout]);
  useLayoutEffect(() => {
    const next: ReadoutTargets | null =
      lead === null ? null : { lead: lead.id, character, channels: targets, proxy: proxyRef };
    readout.setTargets(next);
  }, [readout, lead, character, targets, proxyRef]);
  // A new selection (or unmount) ends a running nudge on the old one.
  useEffect(() => () => nudge.end(false), [nudge, selected]);

  /** Row names selected for the lead (the Graph Editor highlights the same refs); the proxy as its own key. */
  const selectedNames = useMemo(() => {
    const names = new Set<RowKey>();
    for (const ref of channelRefs) {
      if (proxyRef !== null && ref.control === proxyRef.control && ref.channel === proxyRef.channel) {
        names.add(PROXY_CELL);
      } else if (ref.control === lead?.id) names.add(ref.channel);
    }
    return names;
  }, [channelRefs, lead, proxyRef]);

  /** Every row key in display order (rows, then the proxy). */
  const rowKeys = useMemo(
    (): readonly RowKey[] => (proxyRef === null ? rows : [...rows, PROXY_CELL]),
    [rows, proxyRef],
  );

  const refsOf = useStableCallback((key: RowKey): ChannelRef[] => {
    if (key === PROXY_CELL) return proxyRef === null ? [] : [proxyRef];
    return (targets.get(key) ?? []).map((control) => ({ control, channel: key }));
  });

  const writeNames = useStableCallback((names: ReadonlySet<RowKey>): void => {
    const refs: ChannelRef[] = [];
    for (const key of rowKeys) if (names.has(key)) refs.push(...refsOf(key));
    setChannelSelection(app, refs);
  });

  /** The channels an action on `key` covers: the selected names when it is one of them (never the proxy's). */
  const scopeOf = useStableCallback((key: RowKey): RowKey[] => {
    if (key === PROXY_CELL) return [PROXY_CELL];
    return selectedNames.has(key) ? rows.filter((c) => selectedNames.has(c)) : [key];
  });

  const unitOf = (control: ControlId, channel: ChannelId) =>
    channelUnit(byId.get(control) ?? app.store.get('controls', control) ?? null, channel);

  const commit = useStableCallback((key: RowKey, text: string): string | null => {
    nudge.end(false);
    const edits: ChannelEdit[] = [];
    for (const row of scopeOf(key)) {
      for (const ref of refsOf(row)) {
        const unit = unitOf(ref.control, ref.channel);
        const current = toDisplayValue(ref.channel, readout.value(ref.control, ref.channel), unit);
        const next = parseNumericInput(text, current);
        if (next === null) return `'${text}' is not a number or expression`;
        edits.push({ control: ref.control, channel: ref.channel, value: fromDisplayValue(ref.channel, next, unit) });
      }
    }
    if (edits.length === 0) return null;
    const scope = scopeOf(key);
    const label =
      key === PROXY_CELL
        ? 'Set IK/FK'
        : scope.length === 1
          ? `Set ${channelRowLabel(lead, key)}`
          : `Set ${scope.length} Channels`;
    void runOperator(app, PANEL_KIND, 'channel.setValues', { edits, key: 'auto', label });
    return null;
  });

  const isLocked = (control: ControlId, channel: ChannelId): boolean => {
    const record = byId.get(control);
    return record !== undefined && isChannelLockedOn(record, channel);
  };

  const onNudge = useStableCallback((key: RowKey, direction: 1 | -1, modifiers: NudgeModifiers): void => {
    const scope = scopeOf(key);
    const map = new Map<ChannelId, ControlId[]>();
    for (const row of scope) {
      for (const ref of refsOf(row)) {
        if (isLocked(ref.control, ref.channel)) continue;
        map.set(ref.channel, [...(map.get(ref.channel) ?? []), ref.control]);
      }
    }
    const first = refsOf(key)[0];
    const channel = first?.channel ?? (key as ChannelId);
    const unit = first === undefined ? undefined : unitOf(first.control, first.channel);
    const label =
      key === PROXY_CELL
        ? 'Nudge IK/FK'
        : scope.length === 1
          ? `Nudge ${channelRowLabel(lead, key)}`
          : `Nudge ${scope.length} Channels`;
    nudge.press(map, direction * nudgeStep(channel, modifiers, unit), label);
  });
  const onNudgeEnd = useStableCallback((cancel: boolean) => nudge.end(cancel));
  /** FR-CB-04: a locked channel rejects edits with a toast (its field is read-only). */
  const onLockedEdit = useStableCallback((key: RowKey): void => {
    app.services.notify.toast({
      kind: 'warning',
      text: `${channelRowLabel(lead, key as ChannelId)} is locked. Unlock it from the right-click menu to edit it.`,
    });
  });

  // ---------- focus order (Tab / Shift+Tab cycle through the editable fields) ----------
  const fields = useRef(new Map<RowKey, HTMLInputElement>());
  const fieldRef = useStableCallback((key: RowKey, input: HTMLInputElement | null): void => {
    if (input === null) fields.current.delete(key);
    else fields.current.set(key, input);
  });
  const onTab = useStableCallback((key: RowKey, backwards: boolean): void => {
    const editable = rowKeys.filter((c) => c === PROXY_CELL || (lead !== null && !isChannelLockedOn(lead, c)));
    if (editable.length === 0) return;
    const at = editable.indexOf(key);
    const next = editable[(at + (backwards ? -1 : 1) + editable.length) % editable.length];
    if (next !== undefined) fields.current.get(next)?.focus();
  });

  // ---------- virtual slider (§5.18) ----------
  const slider = useRef<VirtualSliderDrag | null>(null);
  useEffect(() => () => slider.current?.end(false), []);
  /** The refs a slider pressed on `key` drives: the selected names when it is one of them, else its own channel. */
  const sliderRefs = (key: RowKey): ChannelRef[] => {
    const keys = key !== PROXY_CELL && selectedNames.has(key) ? [...selectedNames] : [key];
    return keys.flatMap((k) => refsOf(k));
  };
  const startSlider = useStableCallback(
    (key: RowKey, element: HTMLElement, press: globalThis.PointerEvent, initialDx: number): boolean => {
      if (slider.current?.active === true) return false;
      nudge.end(false);
      const drag = startVirtualSliderDrag(app, sliderRefs(key), element, press, {
        pointerLock,
        initialDx,
        onEnd: () => {
          slider.current = null;
        },
      });
      if (drag === null) return false;
      slider.current = drag;
      return true;
    },
  );
  /** MMB press on any row starts the slider at once. */
  const onRowPointerDown = useStableCallback((key: RowKey, event: PointerEvent<HTMLElement>): void => {
    if (event.button !== 1) return;
    event.preventDefault();
    startSlider(key, event.currentTarget, event.nativeEvent, 0);
  });

  // ---------- channel-name selection: click with modifiers, drag down the names for a range ----------
  const drag = useRef<{
    readonly anchor: RowKey;
    readonly base: ReadonlySet<RowKey>;
    readonly key: RowKey;
    readonly x: number;
    /** `movementX` integrated since the press: the slider's first increment (§5.18: never clientX differences). */
    mx: number;
    readonly row: HTMLElement | null;
  } | null>(null);
  useEffect(() => {
    const stop = (): void => {
      drag.current = null;
    };
    const move = (event: globalThis.PointerEvent): void => {
      const state = drag.current;
      if (state === null || (event.buttons & 1) === 0 || state.row === null) return;
      state.mx += event.movementX;
      if (Math.abs(event.clientX - state.x) < LMB_SLIDER_PX) return;
      // An LMB drag of ≥ 3 px sideways from a name is the virtual slider (§5.18); the click already selected it. Its
      // first increment is the movementX so far, not the clientX distance: clientX is fractional where movementX is
      // whole pixels, and mixing them gave 10.1667° for a 20 px drag in 6 moves (acceptance fix round 1).
      drag.current = null;
      startSlider(state.key, state.row, event, state.mx);
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('pointermove', move);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('pointermove', move);
    };
  }, [startSlider]);
  const onNamePointerDown = useStableCallback((key: RowKey, event: PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    const mode = selectModeOf(app, event);
    const names = new Set(mode === 'replace' ? [] : selectedNames);
    if (mode === 'replace' || mode === 'add') names.add(key);
    else if (mode === 'remove') names.delete(key);
    else if (names.has(key)) names.delete(key);
    else names.add(key);
    drag.current =
      mode === 'remove'
        ? null
        : {
            anchor: key,
            base: new Set(mode === 'replace' ? [] : selectedNames),
            key,
            x: event.clientX,
            mx: 0,
            row: event.currentTarget.closest('tr'),
          };
    writeNames(names);
  });
  const onNamePointerEnter = useStableCallback((key: RowKey, event: PointerEvent<HTMLElement>): void => {
    const state = drag.current;
    if (state === null || (event.buttons & 1) === 0) return;
    const from = rowKeys.indexOf(state.anchor);
    const to = rowKeys.indexOf(key);
    const names = new Set(state.base);
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
      const c = rowKeys[i];
      if (c !== undefined) names.add(c);
    }
    writeNames(names);
  });

  // ---------- RMB menu ----------
  const menu = useContextMenu();
  const onMenu = useStableCallback((key: RowKey, event: MouseEvent): void => {
    nudge.end(false);
    const scope = scopeOf(key);
    if (!selectedNames.has(key)) writeNames(new Set([key]));
    const refs = scope.flatMap((row) => refsOf(row));
    const lockable = refs.filter((ref) => !ref.channel.startsWith('@'));
    const allLocked = lockable.length > 0 && lockable.every((ref) => isLocked(ref.control, ref.channel));
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
            edits: refs.map((ref) => ({
              ...ref,
              value: channelDefaultOf(app.store.get('controls', ref.control) ?? null, ref.channel),
            })),
            key: 'auto',
            label: 'Reset to Default',
          }),
      },
      {
        kind: 'item',
        id: 'lock',
        label: allLocked ? 'Unlock Selected' : 'Lock Selected',
        testId: 'cb-menu-lock',
        // §5.1 rule 1: attributes cannot be locked in M2a.
        disabled: lockable.length === 0,
        title: lockable.length === 0 ? 'Attributes cannot be locked' : undefined,
        onSelect: () => void runOperator(app, PANEL_KIND, 'channel.toggleLock', { refs: lockable, locked: !allLocked }),
      },
    ]);
  });

  if (lead === null && modelLead !== null) {
    return (
      <Suspense fallback={null}>
        <MeshChannels app={app} lead={modelLead} />
      </Suspense>
    );
  }
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
      {rowKeys.length === 0 ? (
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
              {/* The IK/FK row's switch button: a sized column, else the fixed table splits the free width between
                  it and the names on every row ('Translat...', acceptance fix round 1). */}
              {limb !== null && proxyRef !== null ? <col className="w-6" /> : null}
            </colgroup>
            <tbody>
              {rows.map((channel) => (
                <ChannelRow
                  key={channel}
                  readout={readout}
                  rowKey={channel}
                  label={channelRowLabel(lead, channel)}
                  nameTestId={`cb-name-${channel}`}
                  fieldTestId={`cb-field-${channel}`}
                  nameSelected={selectedNames.has(channel)}
                  locked={!channel.startsWith('@') && isChannelLocked(lead, channel as TrsChannel)}
                  fieldRef={fieldRef}
                  onCommit={commit}
                  onNudge={onNudge}
                  onNudgeEnd={onNudgeEnd}
                  onTab={onTab}
                  onLockedEdit={onLockedEdit}
                  onNamePointerDown={onNamePointerDown}
                  onNamePointerEnter={onNamePointerEnter}
                  onRowPointerDown={onRowPointerDown}
                  onMenu={onMenu}
                />
              ))}
              {limb !== null && proxyRef !== null ? (
                <IkFkRow
                  app={app}
                  limb={limb}
                  readout={readout}
                  nameSelected={selectedNames.has(PROXY_CELL)}
                  fieldRef={fieldRef}
                  onCommit={commit}
                  onNudge={onNudge}
                  onNudgeEnd={onNudgeEnd}
                  onTab={onTab}
                  onNamePointerDown={onNamePointerDown}
                  onNamePointerEnter={onNamePointerEnter}
                  onRowPointerDown={onRowPointerDown}
                  onMenu={onMenu}
                />
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      {menu.element}
    </div>
  );
}

interface RowHandlers {
  readonly fieldRef: (key: RowKey, input: HTMLInputElement | null) => void;
  readonly onCommit: (key: RowKey, text: string) => string | null;
  readonly onNudge: (key: RowKey, direction: 1 | -1, modifiers: NudgeModifiers) => void;
  readonly onNudgeEnd: (cancel: boolean) => void;
  readonly onTab: (key: RowKey, backwards: boolean) => void;
  readonly onNamePointerDown: (key: RowKey, event: PointerEvent<HTMLElement>) => void;
  readonly onNamePointerEnter: (key: RowKey, event: PointerEvent<HTMLElement>) => void;
  readonly onRowPointerDown: (key: RowKey, event: PointerEvent<HTMLElement>) => void;
  readonly onMenu: (key: RowKey, event: MouseEvent) => void;
}

interface ChannelRowProps extends RowHandlers {
  readonly readout: ChannelReadout;
  readonly rowKey: RowKey;
  readonly label: string;
  /** `data-testid` of the name button and of the field (`cb-name-<channel>`, `cb-field-<channel>`). */
  readonly nameTestId: string;
  readonly fieldTestId: string;
  readonly nameSelected: boolean;
  readonly locked: boolean;
  readonly onLockedEdit: (key: RowKey) => void;
}

const NO_CELL: ChannelCell = { text: '', mixed: false, state: 'static', clipFrame: null, pending: false };

/** A row's readout cell; subscribing to its own cell, so a value change re-renders this row only. */
function useCell(readout: ChannelReadout, key: RowKey): ChannelCell {
  const getCell = useCallback(() => readout.cell(key) ?? NO_CELL, [readout, key]);
  return useSyncExternalStore(readout.subscribe, getCell, getCell);
}

/** The channel name button (selection, LMB-drag virtual slider) and the state-coloured expression field. */
function RowCells(props: ChannelRowProps & { readonly cell: ChannelCell; readonly title?: string }): JSX.Element {
  const { rowKey, locked, cell, label } = props;
  const style = CHANNEL_STATE_STYLE[cell.state];
  const title = props.title ?? channelStateTitle(cell.state, cell.clipFrame);
  return (
    <>
      <th scope="row" className="min-w-0 p-0 font-normal">
        <button
          type="button"
          tabIndex={-1}
          className={`block h-[20px] w-full truncate rounded-[3px] px-1 text-right text-fg-2 ${
            props.nameSelected ? `${ROW_SELECTED} text-fg` : ROW_HOVER
          }`}
          aria-pressed={props.nameSelected}
          title={`${label}: click to select (Shift toggle, drag down for a range, drag sideways or MMB-drag to scrub); RMB for keying and locks`}
          data-testid={props.nameTestId}
          onPointerDown={(event) => props.onNamePointerDown(rowKey, event)}
          onPointerEnter={(event) => props.onNamePointerEnter(rowKey, event)}
        >
          {label}
        </button>
      </th>
      <td className="relative p-0">
        <StateCue bar={style.bar} />
        <ExpressionField
          bindInput={(input) => props.fieldRef(rowKey, input)}
          text={cell.text}
          readOnly={locked}
          ariaLabel={label}
          title={`${title}${cell.mixed ? ' · values differ between the selected controls' : ''}`}
          testId={props.fieldTestId}
          className={`w-full pl-2.5 text-right tabular-nums ${cell.mixed ? 'italic' : ''} ${cell.pending ? 'underline decoration-dotted' : ''}`}
          style={{ background: style.fill, color: style.text }}
          onCommit={(text) => props.onCommit(rowKey, text)}
          onNudge={(direction, modifiers) => props.onNudge(rowKey, direction, modifiers)}
          onNudgeEnd={props.onNudgeEnd}
          onTab={(backwards) => props.onTab(rowKey, backwards)}
          onRejectedEdit={locked ? () => props.onLockedEdit(rowKey) : undefined}
        />
      </td>
    </>
  );
}

/** One channel row. */
const ChannelRow = memo(function ChannelRow(props: ChannelRowProps): JSX.Element {
  const cell = useCell(props.readout, props.rowKey);
  return (
    <tr
      className="h-[22px]"
      data-channel={props.rowKey}
      data-state={cell.state}
      onContextMenu={(event) => props.onMenu(props.rowKey, event)}
      onPointerDown={(event) => props.onRowPointerDown(props.rowKey, event)}
      onAuxClick={(event) => event.preventDefault()}
    >
      <RowCells {...props} cell={cell} />
    </tr>
  );
});

/**
 * The IK/FK proxy row (§5.6): the limb IK control's `@ikFk` (0 FK … 1 IK), editable like a channel (selecting its
 * name makes `@ikFk` a selected Channel Box channel, so `S` keys it), and a button that switches the limb to the
 * other mode with match (`rig.ikFk.switch`, key mode from the preference).
 */
function IkFkRow(
  props: RowHandlers & {
    readonly app: EditorApp;
    readonly limb: LimbDesc;
    readonly readout: ChannelReadout;
    readonly nameSelected: boolean;
  },
): JSX.Element {
  const { app, limb } = props;
  const cell = useCell(props.readout, PROXY_CELL);
  // The cell re-renders the row whenever the value changes; the mode follows the (clamped) value.
  void cell.text;
  const isIk = props.readout.value(limb.params.ikControl, '@ikFk') >= 0.5;
  const to = isIk ? 'fk' : 'ik';
  const name = LIMB_NAME[limb.id];
  return (
    <tr
      className="h-[24px]"
      data-channel="@ikFk"
      data-state={cell.state}
      data-testid="cb-ikfk-row"
      data-limb={limb.id}
      data-mode={isIk ? 'ik' : 'fk'}
      onContextMenu={(event) => props.onMenu(PROXY_CELL, event)}
      onPointerDown={(event) => props.onRowPointerDown(PROXY_CELL, event)}
      onAuxClick={(event) => event.preventDefault()}
    >
      <RowCells
        {...props}
        rowKey={PROXY_CELL}
        label="IK/FK"
        nameTestId="cb-ikfk-name"
        fieldTestId="cb-ikfk-field"
        locked={false}
        onLockedEdit={() => {}}
        cell={cell}
        title={`${name}: 0 = FK, 1 = IK (${channelStateTitle(cell.state, cell.clipFrame)})`}
      />
      <td className="w-6 p-0">
        <button
          type="button"
          className={`${BUTTON} h-[20px] px-1`}
          title={`Switch ${name} to ${to.toUpperCase()} (matches the pose; key mode from Attributes › Limb)`}
          aria-label={`Switch ${name} to ${to.toUpperCase()}`}
          data-testid="cb-ikfk-switch"
          onClick={() => void runOperator(app, PANEL_KIND, 'rig.ikFk.switch', { limb: limb.id, to, match: true })}
        >
          ⇄
        </button>
      </td>
    </tr>
  );
}

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
