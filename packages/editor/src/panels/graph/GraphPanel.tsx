// Graph Editor panel (MVP-SPEC §7 WP-6, research 09 §4.7): toolbar, numeric fields, the channel list and the curve
// view, in a resizable split. Panel-local state: filter, "only animated", hidden curves, collapsed rows; M2a: the
// view mode (M2A-SPEC §5.15.2), persisted with the layout in the dockview panel's parameters.
import { buildChannelTree, type GraphEditorController, selectModeFor } from '@ekza-animator/curve-editor';
import type { DocumentStore } from '@ekza-animator/doc';
import type { ChannelRef, GraphViewMode } from '@ekza-animator/editor-core';
import { type JSX, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useOptionalShell } from '../../shell/context';
import { Group, Panel, Separator as SplitSeparator } from 'react-resizable-panels';
import { useDocQuery, useSession } from '../../hooks';
import type { PanelProps } from '../types';
import { ChannelList, channelLockState, type ModifierEvent, modifiers } from './ChannelList';
import { GraphCanvas } from './GraphCanvas';
import { GraphToolbar } from './GraphToolbar';
import { KeyFields } from './KeyFields';
import {
  applyChannelSelection,
  flattenRows,
  keyFieldValues,
  listedControls,
  sameTree,
  selectedKeys,
  toolbarState,
  visibleCurves,
} from './model';

const DOC_TABLES = ['characters', 'rigs', 'controls', 'clips', 'layers', 'curves', 'keys'] as const;

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** The dockview panel parameter that holds a Graph Editor instance's view mode (§5.15.2: persisted with the layout). */
export const VIEW_MODE_PARAM = 'graphViewMode';

const isViewMode = (value: unknown): value is GraphViewMode =>
  value === 'absolute' || value === 'normalized' || value === 'stacked';

/**
 * Follows the controller's view mode and keeps it in the panel's layout parameters: a restored layout restores the
 * mode, and every change is written back (the workspace saves the layout on parameter changes).
 */
function usePersistedViewMode(controller: GraphEditorController | null, instanceId: string): GraphViewMode {
  const shell = useOptionalShell();
  const subscribe = useCallback(
    (notify: () => void) => controller?.onViewModeChange(notify) ?? (() => {}),
    [controller],
  );
  const mode = useSyncExternalStore(subscribe, () => controller?.viewMode ?? 'absolute');
  useEffect(() => {
    if (controller === null) return undefined;
    const stored: unknown = shell?.workspace.dockview?.getPanel(instanceId)?.params?.[VIEW_MODE_PARAM];
    if (isViewMode(stored)) controller.setViewMode(stored);
    return controller.onViewModeChange((next) => {
      const target = shell?.workspace.dockview?.getPanel(instanceId);
      if (target === undefined) return;
      try {
        target.api.updateParameters({ ...target.params, [VIEW_MODE_PARAM]: next });
      } catch (error) {
        console.warn('Graph Editor: the view mode was not saved with the layout:', error);
      }
    });
  }, [controller, instanceId, shell]);
  return mode;
}

export function GraphPanel({ app, instanceId }: PanelProps): JSX.Element {
  const [filter, setFilter] = useState('');
  const [onlyAnimated, setOnlyAnimated] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [controller, setController] = useState<GraphEditorController | null>(null);
  const viewMode = usePersistedViewMode(controller, instanceId);

  const character = useSession((s) => s.activeCharacter);
  const clipId = useSession((s) => (s.activeCharacter === null ? null : (s.activeClip[s.activeCharacter] ?? null)));
  const selectedControls = useSession((s) => s.selection.controls);
  const channelSelection = useSession((s) => s.selection.channels);
  const keySelection = useSession((s) => s.selection.keys);

  const readTree = useCallback(
    (store: DocumentStore) => {
      const controls = listedControls(store, { character, clip: clipId, selectedControls });
      return { controls, tree: buildChannelTree(app, { clip: clipId, controls, filter, onlyAnimated }) };
    },
    [app, character, clipId, selectedControls, filter, onlyAnimated],
  );
  const { controls, tree: readTreeResult } = useDocQuery(readTree, DOC_TABLES);
  // Key edits (every drag update) re-read the tree; keep the previous one while it shows the same rows, so the
  // channel list and the curve view are not re-rendered for them.
  const [tree, setTree] = useState(readTreeResult);
  if (tree !== readTreeResult && !sameTree(tree, readTreeResult)) setTree(readTreeResult);

  const visibleRaw = useMemo(() => visibleCurves(tree, channelSelection, hidden), [tree, channelSelection, hidden]);
  const [visible, setVisible] = useState(visibleRaw);
  if (!sameIds(visible, visibleRaw)) setVisible(visibleRaw);

  const readKeys = useCallback((store: DocumentStore) => selectedKeys(store, keySelection), [keySelection]);
  const keys = useDocQuery(readKeys, ['keys', 'curves', 'clips']);
  const fields = useMemo(() => keyFieldValues(app, keys), [app, keys]);
  const readToolbar = useCallback(
    (store: DocumentStore) => toolbarState(store, keys, channelSelection, visible),
    [keys, channelSelection, visible],
  );
  const toolbar = useDocQuery(readToolbar, ['curves', 'keys']);
  const readLocks = useCallback(
    (store: DocumentStore) => (node: Parameters<typeof channelLockState>[1]) => channelLockState(store, node),
    [],
  );
  const isLocked = useDocQuery(readLocks, ['controls', 'curves']);
  const rows = useMemo(() => flattenRows(tree, collapsed), [tree, collapsed]);

  const onSelectChannels = useCallback(
    (refs: readonly ChannelRef[], e: ModifierEvent) => {
      const state = app.session.getState();
      const mode = selectModeFor(modifiers(app, e));
      // Channel selection has no operator (MVP-SPEC §4.9): it is U state shared with the Channel Box.
      app.session.setState({
        selection: { ...state.selection, channels: applyChannelSelection(state.selection.channels, refs, mode) },
      });
    },
    [app],
  );
  const toggleExpanded = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleHidden = useCallback((ids: readonly string[], hide: boolean) => {
    setHidden((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (hide) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel text-fg" data-testid="graph-panel">
      <div className="flex shrink-0 flex-col gap-1 border-b border-line bg-header px-1.5 py-1">
        <GraphToolbar
          app={app}
          state={toolbar}
          controller={controller}
          hasControls={controls.length > 0}
          viewMode={viewMode}
        />
        <KeyFields app={app} fields={fields} />
      </div>
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize="22%" minSize={120}>
          <ChannelList
            app={app}
            rows={rows}
            selected={channelSelection}
            hidden={hidden}
            filter={filter}
            onlyAnimated={onlyAnimated}
            onFilter={setFilter}
            onOnlyAnimated={setOnlyAnimated}
            onToggleExpanded={toggleExpanded}
            onToggleHidden={toggleHidden}
            onSelect={onSelectChannels}
            isLocked={isLocked}
          />
        </Panel>
        <SplitSeparator className="w-px bg-line hover:bg-[var(--accent)]" />
        <Panel minSize={160}>
          <GraphCanvas app={app} curves={visible} onController={setController} />
        </Panel>
      </Group>
    </div>
  );
}
