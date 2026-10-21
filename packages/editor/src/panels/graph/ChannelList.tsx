// Graph Editor channel list (research 09 §4.7): character › control › channel rows (virtualized), colour swatches,
// show/hide (eye) and lock per channel, a name filter and "only animated". Clicking selects channels (Shift toggle,
// Mod remove, Mod+Shift add) and shows only their curves; double-clicking a channel selects all keys of its curve.
import { type ChannelTreeNode, selectModeFor } from '@ekza-studio/curve-editor';
import type { ControlRecord, DocumentStore } from '@ekza-studio/doc';
import type { ChannelRef, EditorApp } from '@ekza-studio/editor-core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type JSX, type MouseEvent, memo, useRef } from 'react';
import { type ChannelRow, rowRefs } from './model';
import { runGraphOperator } from './run';

const ROW_HEIGHT = 22;

/** Whether the channel is locked (ControlRecord.locked for TRS channels, CurveRecord.locked otherwise). */
export function channelLockState(store: DocumentStore, node: ChannelTreeNode): boolean {
  if (node.kind !== 'channel' || node.control === undefined || node.channel === undefined) return false;
  const channel = node.channel;
  const control: ControlRecord | undefined = store.get('controls', node.control);
  if (control !== undefined && channel.length === 2) {
    const group = channel[0] === 't' ? control.locked.t : channel[0] === 'r' ? control.locked.r : control.locked.s;
    const axis = 'xyz'.indexOf(channel[1] ?? '');
    if (axis !== -1 && group[axis] === true) return true;
  }
  const curve = node.curve === undefined ? undefined : store.get('curves', node.curve);
  return curve?.locked === true;
}

export interface ChannelListProps {
  readonly app: EditorApp;
  readonly rows: readonly ChannelRow[];
  readonly selected: readonly ChannelRef[];
  readonly hidden: ReadonlySet<string>;
  readonly filter: string;
  readonly onlyAnimated: boolean;
  readonly onFilter: (filter: string) => void;
  readonly onOnlyAnimated: (value: boolean) => void;
  readonly onToggleExpanded: (id: string) => void;
  readonly onToggleHidden: (ids: readonly string[], hidden: boolean) => void;
  readonly onSelect: (refs: readonly ChannelRef[], e: ModifierEvent) => void;
  readonly isLocked: (node: ChannelTreeNode) => boolean;
}

/** Re-renders only when its rows, selection or callbacks change (not on every key edit of a drag). */
export const ChannelList = memo(function ChannelList(props: ChannelListProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual is not memoizable; nothing here is compiled by React Compiler
  const virtualizer = useVirtualizer({
    count: props.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });
  const isSelected = (node: ChannelTreeNode): boolean =>
    node.kind === 'channel' &&
    props.selected.some((ref) => ref.control === node.control && ref.channel === node.channel);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="ge-channel-list">
      <div className="flex shrink-0 items-center gap-1 border-b border-line p-1">
        <input
          className="h-6 min-w-0 flex-1 rounded-[3px] bg-[var(--bg-field,#17181b)] px-1.5 text-[11px] text-fg outline-none placeholder:text-fg-3 focus:ring-1 focus:ring-[var(--accent)]"
          data-testid="ge-channel-filter"
          placeholder="Filter channels…"
          value={props.filter}
          onChange={(e) => props.onFilter(e.currentTarget.value)}
          aria-label="Filter channels"
        />
        <label className="flex shrink-0 items-center gap-1 text-[11px] text-fg-2" title="Show only channels with keys">
          <input
            type="checkbox"
            data-testid="ge-only-animated"
            checked={props.onlyAnimated}
            onChange={(e) => props.onOnlyAnimated(e.currentTarget.checked)}
          />
          Animated
        </label>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" role="tree" aria-label="Channels">
        {props.rows.length === 0 ? (
          <p className="p-2 text-[11px] text-fg-3" data-testid="ge-channel-empty">
            Select controls to see their curves.
          </p>
        ) : null}
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = props.rows[item.index];
            if (row === undefined) return null;
            return (
              <ChannelRowView
                key={row.node.id}
                app={props.app}
                row={row}
                top={item.start}
                selected={isSelected(row.node)}
                hidden={row.node.kind === 'channel' ? props.hidden.has(row.node.id) : allHidden(row.node, props.hidden)}
                locked={props.isLocked(row.node)}
                onToggleExpanded={props.onToggleExpanded}
                onToggleHidden={props.onToggleHidden}
                onSelect={props.onSelect}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});

function channelIds(node: ChannelTreeNode): string[] {
  return node.kind === 'channel' ? [node.id] : node.children.flatMap(channelIds);
}

function allHidden(node: ChannelTreeNode, hidden: ReadonlySet<string>): boolean {
  const ids = channelIds(node);
  return ids.length > 0 && ids.every((id) => hidden.has(id));
}

function ChannelRowView(props: {
  readonly app: EditorApp;
  readonly row: ChannelRow;
  readonly top: number;
  readonly selected: boolean;
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly onToggleExpanded: (id: string) => void;
  readonly onToggleHidden: (ids: readonly string[], hidden: boolean) => void;
  readonly onSelect: (refs: readonly ChannelRef[], e: ModifierEvent) => void;
}): JSX.Element {
  const { app, row } = props;
  const node = row.node;
  const expandable = node.children.length > 0;
  const onClick = (e: MouseEvent): void => {
    if (node.kind === 'character') return;
    props.onSelect(rowRefs(node), e);
  };
  const onDoubleClick = (e: MouseEvent): void => {
    if (node.kind !== 'channel' || node.curve === undefined) return;
    runGraphOperator(app, 'select.curveKeys', { curve: node.curve, mode: selectModeFor(modifiers(app, e)) });
  };
  const toggleLock = (e: MouseEvent): void => {
    e.stopPropagation();
    if (node.control === undefined || node.channel === undefined) return;
    runGraphOperator(app, 'channel.toggleLock', {
      refs: [{ control: node.control, channel: node.channel }],
      locked: !props.locked,
    });
  };
  return (
    <div
      className={`absolute left-0 flex w-full items-center gap-1 pr-1 text-[11px] ${
        props.selected ? 'bg-[var(--bg-selected,#3b3270)] text-fg' : 'text-fg-2 hover:bg-[var(--bg-hover,#30323a)]'
      }`}
      style={{ top: props.top, height: ROW_HEIGHT, paddingLeft: 4 + row.depth * 12 }}
      data-testid={`ge-row-${node.id}`}
      role="treeitem"
      aria-selected={props.selected}
      aria-expanded={expandable ? row.expanded : undefined}
      aria-level={row.depth + 1}
      tabIndex={-1}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (node.kind !== 'character') props.onSelect(rowRefs(node), e);
        } else if ((e.key === 'ArrowRight' && !row.expanded) || (e.key === 'ArrowLeft' && row.expanded)) {
          if (expandable) props.onToggleExpanded(node.id);
        }
      }}
    >
      <button
        type="button"
        className="w-3 shrink-0 text-fg-3 disabled:invisible"
        disabled={!expandable}
        aria-label={row.expanded ? 'Collapse' : 'Expand'}
        onClick={(e) => {
          e.stopPropagation();
          props.onToggleExpanded(node.id);
        }}
      >
        {row.expanded ? '▾' : '▸'}
      </button>
      {node.kind === 'character' ? null : (
        <button
          type="button"
          className={`w-4 shrink-0 ${props.hidden ? 'text-fg-3 opacity-50' : 'text-fg-2'}`}
          data-testid={`ge-eye-${node.id}`}
          title={props.hidden ? 'Show curve' : 'Hide curve'}
          aria-pressed={!props.hidden}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleHidden(channelIds(node), !props.hidden);
          }}
        >
          <EyeIcon open={!props.hidden} />
        </button>
      )}
      {node.kind === 'channel' ? (
        <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: node.color }} aria-hidden="true" />
      ) : null}
      <span
        className={`min-w-0 flex-1 truncate ${node.kind === 'channel' && node.curve === undefined ? 'text-fg-3' : ''}`}
      >
        {node.label}
      </span>
      {node.kind === 'channel' ? (
        <button
          type="button"
          className={`w-4 shrink-0 ${props.locked ? 'text-[var(--locked-badge,#e3b34a)]' : 'text-fg-3 opacity-40 hover:opacity-100'}`}
          data-testid={`ge-lock-${node.id}`}
          title={props.locked ? 'Unlock channel' : 'Lock channel (no edits)'}
          aria-pressed={props.locked}
          onClick={toggleLock}
        >
          <LockIcon locked={props.locked} />
        </button>
      ) : null}
    </div>
  );
}

function EyeIcon(props: { readonly open: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
      {props.open ? <circle cx="8" cy="8" r="2" fill="currentColor" /> : <path d="M3 13L13 3" />}
    </svg>
  );
}

function LockIcon(props: { readonly locked: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <rect x="3.5" y="7" width="9" height="7" rx="1" fill={props.locked ? 'currentColor' : 'none'} />
      <path d={props.locked ? 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2' : 'M5.5 7V5a2.5 2.5 0 0 1 5 0'} />
    </svg>
  );
}

/** The modifier keys of a DOM mouse or keyboard event. */
export interface ModifierEvent {
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

/** Selection modifiers of a DOM click: Mod is Cmd on macOS, Ctrl elsewhere. */
export function modifiers(app: EditorApp, e: ModifierEvent): { readonly shift: boolean; readonly mod: boolean } {
  return { shift: e.shiftKey, mod: app.keymap.platform === 'mac' ? e.metaKey : e.ctrlKey };
}
