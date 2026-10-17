// Outliner (FR-OUT-01…04, research 09 §4.3): a virtualized ARIA tree of characters with their rig controls,
// skeleton bones and clips. Selection goes through `select.controls` and follows the session both ways; hovering a
// control asks the viewport to pre-highlight it.
import type { CharacterId, ClipId, ClipRecord, ControlId, ControlRecord } from '@ekza-animator/doc';
import { type EditorApp, PANEL, type SessionState } from '@ekza-animator/editor-core';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDocQuery, useSession } from '../../hooks';
import type { PanelProps } from '../types';
import { sameIds, selectedControls, useCharactersVersion } from '../channel-box/kit/hooks';
import { BoneIcon, CharacterIcon, ChevronIcon, ClipIcon, ControlIcon, RigIcon } from '../channel-box/kit/icons';
import { type MenuEntry, useContextMenu } from '../channel-box/kit/menu';
import { runOperator, selectModeOf } from '../channel-box/kit/run';
import {
  BUTTON,
  EMPTY_STATE,
  INPUT,
  PANEL_ROOT,
  PANEL_ROOT_STYLE,
  ROW_HOVER,
  ROW_SELECTED,
  SEL_LEAD_COLOR,
  SIDE_COLOR,
  TOOLBAR,
} from '../channel-box/kit/styles';
import { ClipNameInput } from '../clips/ClipNameInput';
import { setHoveredControl } from './hover';
import {
  buildOutlinerRows,
  controlHierarchy,
  controlKey,
  defaultExpanded,
  groupKey,
  type OutlinerDoc,
  type OutlinerRow,
  readOutlinerDoc,
  revealKeys,
} from './model';

const PANEL_KIND = PANEL.outliner;

// Geometry the virtualizer depends on is inline, not utility classes: it must hold even before (or without) the
// stylesheet, as in component tests.
const SCROLLER_STYLE: CSSProperties = { position: 'relative', flex: '1 1 0', minHeight: 0, overflow: 'auto' };
const ROW_STYLE: CSSProperties = { position: 'absolute', top: 0, left: 0, width: '100%', height: 22 };
const ROW_HEIGHT = 22;
const INDENT = 12;
/** Levels indented by a full INDENT; deeper levels step by DEEP_INDENT so finger chains stay readable at 240 px. */
const FULL_INDENT_LEVELS = 4;
const DEEP_INDENT = 5;

/** Left padding of a row at `depth` (acceptance round 2: at depth 10 the chevron sat mid-row and names read "L …"). */
export function rowIndentPx(depth: number): number {
  const full = Math.min(depth, FULL_INDENT_LEVELS);
  return 4 + full * INDENT + Math.max(0, depth - FULL_INDENT_LEVELS) * DEEP_INDENT;
}
const OUTLINER_TABLES = ['characters', 'rigs', 'controls', 'clips'] as const;
const FORMAT_LABEL = { vrm0: 'VRM 0.x', vrm1: 'VRM 1.0', gltf: 'glTF' } as const;

const selectShowSecondary = (s: SessionState): boolean => s.showSecondary;
const selectHidden = (s: SessionState): ReadonlySet<ControlId> => s.hiddenControls;
const selectActiveCharacter = (s: SessionState): CharacterId | null => s.activeCharacter;
const selectActiveClip = (s: SessionState): SessionState['activeClip'] => s.activeClip;

export function OutlinerPanel({ app, instanceId }: PanelProps): JSX.Element {
  const doc = useDocQuery(readOutlinerDoc, OUTLINER_TABLES);
  const runtimes = useCharactersVersion(app);
  const selected = useSession(selectedControls, sameIds);
  const showSecondary = useSession(selectShowSecondary);
  const hiddenControls = useSession(selectHidden);
  const activeCharacter = useSession(selectActiveCharacter);
  const activeClip = useSession(selectActiveClip);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ClipId | null>(null);
  const menu = useContextMenu();
  const scrollRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const domPrefix = useId();

  const skeletons = useMemo(() => {
    void runtimes; // re-read when the character registry reports a change
    return new Map(app.characters.list().map((runtime) => [runtime.id, runtime.skeleton]));
  }, [app, runtimes]);

  const rows = useMemo(
    () =>
      buildOutlinerRows(doc, {
        filter,
        showSecondary,
        hiddenControls,
        expanded,
        skeletons,
        activeCharacter,
        activeClip,
      }),
    [doc, filter, showSecondary, hiddenControls, expanded, skeletons, activeCharacter, activeClip],
  );
  const indexByKey = useMemo(() => new Map(rows.map((row, i) => [row.key, i])), [rows]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const lead = selected.at(-1) ?? null;

  // TanStack Virtual (MVP-SPEC §2) returns a mutable instance; this component does not rely on compiler memoization.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.key ?? index,
    // Generous: rows just outside the view stay in the DOM (cheap for rigs of a few hundred rows), so a pointer or
    // an e2e locator can scroll them in without a round trip through the virtualizer.
    overscan: 40,
    useFlushSync: false,
  });

  // ---------- selection follows the session (viewport clicks, undo) ----------
  // A new lead is revealed (ancestors expanded) and scrolled into view; for a click in this panel both are no-ops.
  // The reveal reads the latest document but must not re-run (and re-expand) on every document change.
  const docRef = useRef<OutlinerDoc>(doc);
  useLayoutEffect(() => {
    docRef.current = doc;
  }, [doc]);
  const pendingScroll = useRef<string | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  const scrollTo = useCallback((key: string) => {
    pendingScroll.current = key;
    setScrollRequest((n) => n + 1);
  }, []);
  useEffect(() => {
    if (lead === null) return;
    const keys = revealKeys(docRef.current, lead);
    setExpanded((previous) => {
      if (keys.every((key) => previous.get(key) ?? defaultExpanded(key))) return previous;
      const next = new Map(previous);
      for (const key of keys) next.set(key, true);
      return next;
    });
    scrollTo(controlKey(lead));
    setFocusKey(controlKey(lead));
  }, [lead, scrollTo]);
  // Runs after the expansion above has rebuilt the rows (or at once when the row was there already).
  useEffect(() => {
    const key = pendingScroll.current;
    const index = key === null ? undefined : indexByKey.get(key);
    if (index === undefined) return;
    pendingScroll.current = null;
    virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [indexByKey, virtualizer, scrollRequest]);

  // ---------- actions ----------
  const selectControls = useCallback(
    (ids: readonly ControlId[], mode: 'replace' | 'toggle' | 'add' | 'remove'): void => {
      void runOperator(app, PANEL_KIND, 'select.controls', { ids, mode });
    },
    [app],
  );
  const toggle = useCallback((row: OutlinerRow) => {
    if (!row.expandable) return;
    setExpanded((previous) => new Map(previous).set(row.key, !row.expanded));
  }, []);
  const activateClip = useCallback(
    (clip: ClipRecord) => {
      if (activeClip[clip.character] !== clip.id)
        void runOperator(app, PANEL_KIND, 'clip.setActive', { clip: clip.id });
    },
    [app, activeClip],
  );

  const activate = useCallback(
    (
      row: OutlinerRow,
      modifiers: { readonly shiftKey: boolean; readonly metaKey: boolean; readonly ctrlKey: boolean },
    ) => {
      switch (row.kind) {
        case 'character':
        case 'group':
          toggle(row);
          return;
        case 'control':
          selectControls([row.control.id], selectModeOf(app, modifiers));
          return;
        case 'bone':
          if (row.control !== null) selectControls([row.control], selectModeOf(app, modifiers));
          return;
        case 'clip':
          activateClip(row.clip);
          return;
      }
    },
    [app, toggle, selectControls, activateClip],
  );

  const focusRow = useCallback(
    (index: number): void => {
      const at = Math.max(0, Math.min(rows.length - 1, index));
      const row = rows[at];
      if (row === undefined) return;
      setFocusKey(row.key);
      virtualizer.scrollToIndex(at, { align: 'auto' });
    },
    [rows, virtualizer],
  );

  const characterControls = useCallback(
    (character: CharacterId): readonly ControlRecord[] =>
      doc.characters.find((entry) => entry.record.id === character)?.controls ?? [],
    [doc],
  );

  const secondaryEntry: MenuEntry = {
    kind: 'item',
    id: 'secondary',
    label: 'Show Secondary Controls',
    checked: showSecondary,
    testId: 'outliner-menu-secondary',
    onSelect: () => void runOperator(app, PANEL_KIND, 'rig.toggleSecondary', undefined),
  };
  const viewEntries: readonly MenuEntry[] = [
    {
      kind: 'item',
      id: 'expand',
      label: 'Expand All',
      testId: 'outliner-menu-expand-all',
      // Rows start expanded except the skeleton group: open those, forget every collapse.
      onSelect: () =>
        setExpanded(new Map(doc.characters.map((entry) => [groupKey(entry.record.id, 'skeleton'), true]))),
    },
    {
      kind: 'item',
      id: 'collapse',
      label: 'Collapse All',
      testId: 'outliner-menu-collapse-all',
      onSelect: () => setExpanded(new Map(rows.filter((row) => row.expandable).map((row) => [row.key, false]))),
    },
    { kind: 'separator', id: 'sep-view' },
    secondaryEntry,
  ];

  const openMenu = (row: OutlinerRow | null, event: MouseEvent): void => {
    event.stopPropagation();
    if (row !== null) setFocusKey(row.key);
    const target = menuTarget(row);
    if (target !== null) {
      const id = target.control;
      const targets = selectedSet.has(id) ? selected : [id];
      if (!selectedSet.has(id)) selectControls([id], 'replace');
      const controls = characterControls(target.character);
      menu.open(event, 'Control', [
        {
          kind: 'item',
          id: 'hierarchy',
          label: 'Select Hierarchy',
          testId: 'outliner-menu-select-hierarchy',
          onSelect: () => {
            // Descendants first, the original selection last: the lead (Channel Box) stays where it was.
            const all = controlHierarchy(controls, targets, showSecondary);
            const original = new Set(targets);
            selectControls([...all.filter((c) => !original.has(c)), ...targets], 'replace');
          },
        },
        {
          kind: 'item',
          id: 'frame',
          label: 'Frame Selection',
          testId: 'outliner-menu-frame',
          onSelect: () => void runOperator(app, PANEL_KIND, 'view.frame', { what: 'selection' }),
        },
        {
          kind: 'item',
          id: 'reset',
          label: 'Reset Pose',
          testId: 'outliner-menu-reset',
          onSelect: () => void runOperator(app, PANEL_KIND, 'pose.resetToRest', { controls: targets }),
        },
        { kind: 'separator', id: 'sep' },
        secondaryEntry,
      ]);
      return;
    }
    if (row?.kind === 'clip') {
      const clip = row.clip;
      menu.open(event, 'Clip', [
        {
          kind: 'item',
          id: 'active',
          label: 'Set Active',
          disabled: row.active,
          testId: 'outliner-menu-clip-active',
          onSelect: () => activateClip(clip),
        },
        {
          kind: 'item',
          id: 'rename',
          label: 'Rename',
          testId: 'outliner-menu-clip-rename',
          onSelect: () => setRenaming(clip.id),
        },
        {
          kind: 'item',
          id: 'duplicate',
          label: 'Duplicate',
          testId: 'outliner-menu-clip-duplicate',
          onSelect: () => void runOperator(app, PANEL_KIND, 'clip.duplicate', { clip: clip.id }),
        },
        {
          kind: 'item',
          id: 'delete',
          label: 'Delete',
          testId: 'outliner-menu-clip-delete',
          onSelect: () => void runOperator(app, PANEL_KIND, 'clip.delete', { clip: clip.id }),
        },
      ]);
      return;
    }
    menu.open(event, 'Outliner', viewEntries);
  };

  // ---------- keyboard (ARIA tree) ----------
  const focusIndex = focusKey === null ? -1 : (indexByKey.get(focusKey) ?? -1);
  const onTreeKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.target instanceof HTMLInputElement) return; // inline rename
    // Hotkeys follow the hovered panel (§4.10 "Keyboard focus", acceptance round 2): with the pointer over another
    // panel, F, Home, End and the arrows belong to that panel even though the tree still has the DOM focus.
    const hovered = app.session.getState().hoveredPanel;
    if (hovered !== null && hovered.kind !== PANEL.outliner) return;
    const row = focusIndex === -1 ? undefined : rows[focusIndex];
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? ROW_HEIGHT * 10) / ROW_HEIGHT) - 1);
    switch (event.key) {
      case 'ArrowDown':
        focusRow(focusIndex + 1);
        break;
      case 'ArrowUp':
        focusRow(focusIndex === -1 ? 0 : focusIndex - 1);
        break;
      case 'PageDown':
        focusRow(focusIndex + page);
        break;
      case 'PageUp':
        focusRow(focusIndex - page);
        break;
      case 'Home':
        focusRow(0);
        break;
      case 'End':
        focusRow(rows.length - 1);
        break;
      case 'ArrowRight':
        if (row === undefined) focusRow(0);
        else if (row.expandable && !row.expanded) toggle(row);
        else if (row.expandable) focusRow(focusIndex + 1);
        break;
      case 'ArrowLeft':
        if (row === undefined) break;
        if (row.expandable && row.expanded) toggle(row);
        else if (row.parent !== null) focusRow(indexByKey.get(row.parent) ?? focusIndex);
        break;
      // Enter selects. Space is not taken: it stays the global Maya key (maximize the hovered panel, or play).
      case 'Enter':
        if (row !== undefined) activate(row, event);
        break;
      case 'F2':
        if (row?.kind === 'clip') setRenaming(row.clip.id);
        break;
      case '/':
        filterRef.current?.focus();
        break;
      case 'f':
      case 'F':
        if (event.metaKey || event.ctrlKey || event.altKey || lead === null) return;
        scrollTo(controlKey(lead));
        setExpanded((previous) => {
          const next = new Map(previous);
          for (const key of revealKeys(doc, lead)) next.set(key, true);
          return next;
        });
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const rowDomId = (key: string): string => `${domPrefix}-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const items = virtualizer.getVirtualItems();
  const focusedRendered = focusKey !== null && items.some((item) => rows[item.index]?.key === focusKey);

  return (
    <div className={PANEL_ROOT} style={PANEL_ROOT_STYLE} data-testid="outliner-panel" data-instance={instanceId}>
      <div className={TOOLBAR}>
        <input
          ref={filterRef}
          type="search"
          className={`${INPUT} h-[22px] min-w-0 flex-1`}
          placeholder="Filter: name or humanoid bone…"
          aria-label="Filter the outliner"
          spellCheck={false}
          value={filter}
          data-testid="outliner-filter"
          onChange={(event) => setFilter(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && filter !== '') {
              event.preventDefault();
              event.stopPropagation();
              setFilter('');
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              scrollRef.current?.focus();
              focusRow(0);
            }
          }}
        />
        <button
          type="button"
          className={`${BUTTON} ${showSecondary ? 'bg-[var(--bg-pressed,#3a3d46)] text-fg' : ''}`}
          aria-pressed={showSecondary}
          title={showSecondary ? 'Hide secondary controls' : 'Show secondary controls'}
          data-testid="outliner-toggle-secondary"
          onClick={() => void runOperator(app, PANEL_KIND, 'rig.toggleSecondary', undefined)}
        >
          Secondary
        </button>
      </div>
      {rows.length === 0 ? (
        <div className={EMPTY_STATE} data-testid="outliner-empty" onContextMenu={(event) => openMenu(null, event)}>
          {filter.trim() === ''
            ? 'No character yet. Open a model or drop one on the viewport.'
            : `Nothing matches '${filter.trim()}'.`}
        </div>
      ) : (
        <div
          ref={scrollRef}
          role="tree"
          aria-label="Outliner"
          aria-multiselectable="true"
          aria-activedescendant={focusedRendered && focusKey !== null ? rowDomId(focusKey) : undefined}
          tabIndex={0}
          className="group outline-none"
          style={SCROLLER_STYLE}
          data-testid="outliner-tree"
          onKeyDown={onTreeKeyDown}
          onFocus={(event) => {
            if (event.target !== event.currentTarget) return;
            const fallback = lead === null ? (rows[0]?.key ?? null) : controlKey(lead);
            setFocusKey((current) => current ?? fallback);
          }}
          onPointerLeave={() => setHoveredControl(app, null)}
          onContextMenu={(event) => openMenu(null, event)}
        >
          <div style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}>
            {items.map((item) => {
              const row = rows[item.index];
              if (row === undefined) return null;
              const controlId = row.kind === 'control' ? row.control.id : row.kind === 'bone' ? row.control : null;
              return (
                <OutlinerRowView
                  key={row.key}
                  app={app}
                  row={row}
                  domId={rowDomId(row.key)}
                  top={item.start}
                  selected={controlId !== null && row.kind === 'control' && selectedSet.has(controlId)}
                  lead={row.kind === 'control' && controlId === lead}
                  focused={row.key === focusKey}
                  renaming={row.kind === 'clip' && row.clip.id === renaming}
                  onRenamed={() => {
                    setRenaming(null);
                    scrollRef.current?.focus();
                  }}
                  onActivate={(event) => {
                    setFocusKey(row.key);
                    scrollRef.current?.focus({ preventScroll: true });
                    activate(row, event);
                  }}
                  onToggle={() => toggle(row)}
                  onRename={() => {
                    if (row.kind === 'clip') setRenaming(row.clip.id);
                  }}
                  onMenu={(event) => openMenu(row, event)}
                  onHover={() => setHoveredControl(app, controlId)}
                  onKeyDown={onTreeKeyDown}
                />
              );
            })}
          </div>
        </div>
      )}
      {menu.element}
    </div>
  );
}

interface RowViewProps {
  readonly app: EditorApp;
  readonly row: OutlinerRow;
  readonly domId: string;
  readonly top: number;
  readonly selected: boolean;
  readonly lead: boolean;
  readonly focused: boolean;
  readonly renaming: boolean;
  readonly onRenamed: () => void;
  readonly onActivate: (event: MouseEvent) => void;
  readonly onToggle: () => void;
  readonly onRename: () => void;
  readonly onMenu: (event: MouseEvent) => void;
  readonly onHover: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

function rowTestId(row: OutlinerRow): string {
  switch (row.kind) {
    case 'character':
      return `outliner-character-${row.character.id}`;
    case 'group':
      return `outliner-group-${row.group}-${row.character}`;
    case 'control':
      return `outliner-row-${row.control.id}`;
    case 'bone':
      return `outliner-bone-${row.character}-${row.node}`;
    case 'clip':
      return `outliner-clip-${row.clip.id}`;
  }
}

/** The control a row's context menu acts on: the row's control, or the control driving a bone. */
function menuTarget(row: OutlinerRow | null): { readonly control: ControlId; readonly character: CharacterId } | null {
  if (row?.kind === 'control') return { control: row.control.id, character: row.character };
  if (row?.kind === 'bone' && row.control !== null) return { control: row.control, character: row.character };
  return null;
}

const GROUP_LABEL = { rig: 'Rig', skeleton: 'Skeleton', clips: 'Clips' } as const;

function OutlinerRowView(props: RowViewProps): JSX.Element {
  const { app, row, selected, lead, focused } = props;
  const style: CSSProperties = {
    ...ROW_STYLE,
    transform: `translateY(${props.top}px)`,
    paddingLeft: rowIndentPx(row.depth),
  };
  const selectable = row.kind === 'control';
  return (
    <div
      id={props.domId}
      role="treeitem"
      tabIndex={-1}
      aria-level={row.depth + 1}
      aria-expanded={row.expandable ? row.expanded : undefined}
      aria-selected={selectable ? selected : undefined}
      data-testid={rowTestId(row)}
      data-lead={lead ? 'true' : undefined}
      data-match={row.match ? 'true' : undefined}
      className={
        'flex cursor-default items-center gap-1 pr-2 whitespace-nowrap ' +
        `${selected ? ROW_SELECTED : ROW_HOVER} ` +
        (focused ? 'group-focus:shadow-[inset_0_0_0_1px_var(--accent-text,#a996ff)] ' : '') +
        (row.kind === 'control' && row.hidden ? 'opacity-50' : '')
      }
      style={style}
      onClick={props.onActivate}
      onDoubleClick={row.kind === 'clip' ? props.onRename : undefined}
      onContextMenu={props.onMenu}
      onPointerEnter={props.onHover}
      onKeyDown={props.onKeyDown}
    >
      {lead ? (
        <span className="absolute top-0.5 bottom-0.5 left-0 w-[3px] rounded-r" style={{ background: SEL_LEAD_COLOR }} />
      ) : null}
      <span
        className={`grid w-3.5 place-items-center text-fg-3 ${row.expandable ? 'hover:text-fg' : 'invisible'}`}
        aria-hidden="true"
        onClick={(event) => {
          event.stopPropagation();
          props.onToggle();
        }}
      >
        <ChevronIcon open={row.expanded} />
      </span>
      <RowContent app={app} row={row} renaming={props.renaming} onRenamed={props.onRenamed} />
    </div>
  );
}

function RowContent(props: {
  readonly app: EditorApp;
  readonly row: OutlinerRow;
  readonly renaming: boolean;
  readonly onRenamed: () => void;
}): JSX.Element {
  const { row } = props;
  const label = (text: string, strong = false): JSX.Element => (
    <span className={`min-w-0 truncate ${strong ? 'font-semibold' : ''} ${row.match ? 'text-accent-text' : ''}`}>
      {text}
    </span>
  );
  // The secondary text (template key, humanoid name) gives way first, so the name stays readable.
  const secondary = (text: string | null): JSX.Element | null =>
    text === null ? null : <span className="min-w-0 shrink-[4] truncate text-fg-3">{text}</span>;
  switch (row.kind) {
    case 'character':
      return (
        <>
          <span className="text-fg-2">
            <CharacterIcon />
          </span>
          {label(row.character.name, true)}
          {secondary(FORMAT_LABEL[row.character.format])}
          {row.active ? <span className="ml-auto text-fg-3">active</span> : null}
        </>
      );
    case 'group':
      return (
        <>
          <span className="text-fg-2">
            {row.group === 'rig' ? <RigIcon /> : row.group === 'skeleton' ? <BoneIcon /> : <ClipIcon />}
          </span>
          {label(GROUP_LABEL[row.group])}
          {secondary(row.count === null ? '(not loaded)' : `(${row.count})`)}
        </>
      );
    case 'control':
      return (
        <>
          <ControlIcon color={SIDE_COLOR[row.control.side]} />
          {label(row.control.name)}
          {secondary(row.humanoid ?? row.control.key)}
        </>
      );
    case 'bone':
      return (
        <>
          <span className="text-fg-3">
            <BoneIcon />
          </span>
          {label(row.name === '' ? `node ${row.node}` : row.name)}
          {secondary(row.humanoid === row.name ? null : row.humanoid)}
        </>
      );
    case 'clip':
      return (
        <>
          <span
            className={row.active ? 'text-accent-text' : 'text-fg-3'}
            aria-label={row.active ? 'active clip' : undefined}
          >
            {row.active ? '●' : '○'}
          </span>
          {props.renaming ? (
            <ClipNameInput
              app={props.app}
              panel={PANEL_KIND}
              clip={row.clip}
              onDone={props.onRenamed}
              className="h-5"
            />
          ) : (
            label(row.clip.name)
          )}
        </>
      );
  }
}
