// The Model Outliner (M6A-SPEC §8.8, §5.21; research 16 §13; B13; lazy chunk): Scene › groups and meshes, characters ›
// Meshes (glTF meshes: `⊘ asset` with an inline Make editable button, or the editable record), Reference › image
// planes. Badges carry text and a tooltip: triangles, `prim` / `✎` / `⊘ asset`, `⇋X` (symmetry), a lint dot (Mesh
// Check issues), `skin`. A click selects the object (`select.objects`; Shift toggles, Mod removes) or, in a component
// mode, adds a mesh to the hilite set (`model.hilite`); a plane row selects the plane for Attributes. Dragging an
// object onto a group or mesh parents it (`scene.parent`), onto Scene unparents it (`scene.unparent`). RMB: Make
// editable · Rename (`F2`/`Enter`) · Duplicate · Group · Isolate · Center Pivot · Mesh Check · Export Selected….
import type { CharacterId, MeshId, MeshRecord } from '@ekza-animator/doc';
import {
  type EditorApp,
  meshKernel,
  type SceneObjectId,
  type SessionState,
  type SymmetrySettings,
} from '@ekza-animator/editor-core';
import type { MeshData } from '@ekza-animator/mesh-core';
import {
  type DragEvent,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDocQuery, useRunOperator, useSession } from '../../hooks';
import type { PanelProps } from '../types';
import { sameIds, useCharactersVersion } from '../channel-box/kit/hooks';
import { CharacterIcon, ChevronIcon } from '../channel-box/kit/icons';
import { type MenuEntry, useContextMenu } from '../channel-box/kit/menu';
import { hasMod, selectModeOf } from '../channel-box/kit/run';
import {
  BUTTON,
  EMPTY_STATE,
  INPUT,
  PANEL_ROOT,
  PANEL_ROOT_STYLE,
  ROW_HOVER,
  ROW_SELECTED,
  SEL_LEAD_COLOR,
  TOOLBAR,
} from '../channel-box/kit/styles';
import {
  buildModelOutlinerRows,
  type ContainerMeshes,
  containerMeshes,
  dropTargetOf,
  isGroup,
  type ModelOutlinerRow,
  readModelOutlinerDoc,
  rowId,
} from './modelTree';
import { useMeshRuntimesVersion } from '../palette/hooks';
import { setSelectedPlane, useSelectedPlane } from './planeSelection';
import { selectObjects } from './sceneSelection';

const PANEL_KIND = 'outliner';
const TABLES = ['meshes', 'groups', 'characters', 'imagePlanes', 'assets'] as const;
const ROW_HEIGHT = 22;
const INDENT = 12;
const DRAG_TYPE = 'application/x-ekza-scene-objects';

const selectObjectsState = (s: SessionState): readonly SceneObjectId[] => s.selection.objects;
const selectHilite = (s: SessionState): readonly MeshId[] => s.model.hilite;
const selectMode = (s: SessionState): string => s.model.componentMode;
const selectSymmetry = (s: SessionState): ReadonlyMap<MeshId, SymmetrySettings> => s.model.symmetry;
const selectHidden = (s: SessionState): ReadonlySet<SceneObjectId> => s.model.hiddenObjects;

/** Mesh Check issue counts per revision (B5's `checkMesh`; none while it is not available). */
const lintCache = new WeakMap<MeshData, number>();
function lintCount(data: MeshData): number {
  const cached = lintCache.get(data);
  if (cached !== undefined) return cached;
  let count = 0;
  try {
    count = meshKernel()?.checkMesh(data).length ?? 0;
  } catch {
    count = 0;
  }
  lintCache.set(data, count);
  return count;
}

interface MeshBadges {
  readonly tris: number | null;
  readonly state: 'prim' | 'edit' | 'asset';
  readonly symmetry: string | null;
  readonly lints: number;
  readonly skin: boolean;
}

function meshBadges(app: EditorApp, record: MeshRecord, symmetry: SymmetrySettings | undefined): MeshBadges {
  const runtime = app.meshes.get(record.id);
  const data = runtime?.state === 'ready' ? runtime.data() : null;
  let tris: number | null = null;
  if (runtime !== undefined && data !== null) {
    try {
      tris = runtime.triangulation().tris.length / 3;
    } catch {
      tris = null;
    }
  }
  const mode = symmetry?.mode ?? 'off';
  return {
    tris,
    state: record.generator !== null ? 'prim' : 'edit',
    symmetry: mode === 'off' ? null : mode.endsWith('-x') ? 'X' : mode.endsWith('-y') ? 'Y' : 'Z',
    lints: data === null ? 0 : lintCount(data),
    skin: record.skin !== null,
  };
}

function Badges(props: { readonly id: string; readonly badges: MeshBadges }): JSX.Element {
  const { badges } = props;
  const item = 'rounded-[3px] px-1 text-[10px] leading-4';
  return (
    <span
      className="ml-auto flex shrink-0 items-center gap-1 pl-1 text-fg-3"
      data-testid={`outliner-badge-${props.id}`}
    >
      {badges.tris === null ? null : (
        <span className="ekza-numeric" title={`${badges.tris} triangles`}>
          {badges.tris} tris
        </span>
      )}
      {badges.state === 'prim' ? (
        <span className={`${item} bg-[var(--bg-field,#17181b)]`} title="Primitive: its parameters are still live">
          prim
        </span>
      ) : badges.state === 'edit' ? (
        <span className={item} title="Editable mesh">
          ✎
        </span>
      ) : (
        <span className={item} title="Imported asset: read-only until made editable">
          ⊘ asset
        </span>
      )}
      {badges.symmetry === null ? null : (
        <span className={item} title={`Symmetry on ${badges.symmetry}`}>
          ⇋{badges.symmetry}
        </span>
      )}
      {badges.lints === 0 ? null : (
        <span
          className="text-[var(--lint-error,#ef6b6b)]"
          title={`${badges.lints} Mesh Check issue${badges.lints === 1 ? '' : 's'}`}
          aria-label={`${badges.lints} Mesh Check issues`}
        >
          ●
        </span>
      )}
      {badges.skin ? (
        <span className={item} title="Skinned to the character's skeleton">
          skin
        </span>
      ) : null}
    </span>
  );
}

export default function ModelOutliner({ app, instanceId }: PanelProps): JSX.Element {
  const run = useRunOperator();
  const doc = useDocQuery(readModelOutlinerDoc, TABLES);
  // Re-render badges when runtimes load (the value is read through `meshBadges` during render).
  useMeshRuntimesVersion(app);
  const charactersVersion = useCharactersVersion(app);
  const selected = useSession(selectObjectsState, sameIds);
  const hilite = useSession(selectHilite, sameIds);
  const mode = useSession(selectMode);
  const symmetry = useSession(selectSymmetry);
  const hidden = useSession(selectHidden);
  const plane = useSelectedPlane(app);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const menu = useContextMenu();
  const treeRef = useRef<HTMLDivElement>(null);

  const containers = useMemo(() => {
    void charactersVersion;
    const out = new Map<CharacterId, ContainerMeshes>();
    for (const runtime of app.characters.list()) out.set(runtime.id, containerMeshes(runtime.container.json));
    return out;
  }, [app, charactersVersion]);
  const rows = useMemo(
    () => buildModelOutlinerRows(doc, { filter, expanded, containers }),
    [doc, filter, expanded, containers],
  );
  const selectedSet = useMemo(() => new Set<string>(selected), [selected]);
  const hiliteSet = useMemo(() => new Set<string>(hilite), [hilite]);
  const lead = selected.at(-1) ?? null;
  const indexByKey = useMemo(() => new Map(rows.map((row, i) => [row.key, i])), [rows]);

  const toggle = useCallback((row: ModelOutlinerRow) => {
    if (!row.expandable) return;
    setExpanded((previous) => new Map(previous).set(row.key, !row.expanded));
  }, []);

  const activate = (row: ModelOutlinerRow, modifiers: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    setFocusKey(row.key);
    switch (row.kind) {
      case 'section':
      case 'character':
      case 'meshes':
        toggle(row);
        return;
      case 'asset':
        return;
      case 'plane':
        setSelectedPlane(app, row.plane.id);
        return;
      case 'object': {
        const id = row.object.id;
        if (mode !== 'object' && !isGroup(row.object)) {
          // §8.8: in a component mode a click on a mesh row adds it to the hilite set.
          void run(
            'model.hilite',
            { meshes: [id], mode: hasMod(app, modifiers) ? 'remove' : 'add' },
            { panel: PANEL_KIND },
          );
          return;
        }
        setSelectedPlane(app, null);
        void selectObjects(app, run, [id], selectModeOf(app, modifiers), PANEL_KIND);
        return;
      }
    }
  };

  const makeEditable = (row: Extract<ModelOutlinerRow, { kind: 'asset' }>): void => {
    void run('mesh.makeEditable', { character: row.character, meshIndex: row.meshIndex }, { panel: PANEL_KIND }).then(
      (result) => {
        if (result.status === 'finished') void run('ui.open', { dialog: 'makeEditableReport' }, { panel: PANEL_KIND });
      },
    );
  };

  /** The objects an object-row command acts on: the selection when the row is in it, else the row. */
  const targetsOf = (row: Extract<ModelOutlinerRow, { kind: 'object' }>): SceneObjectId[] =>
    selectedSet.has(row.object.id) ? [...selected] : [row.object.id];

  const openMenu = (row: ModelOutlinerRow | null, event: MouseEvent): void => {
    event.stopPropagation();
    if (row !== null) setFocusKey(row.key);
    const viewEntries: MenuEntry[] = [
      {
        kind: 'item',
        id: 'expand',
        label: 'Expand All',
        testId: 'outliner-menu-expand-all',
        onSelect: () => setExpanded(new Map()),
      },
      {
        kind: 'item',
        id: 'collapse',
        label: 'Collapse All',
        testId: 'outliner-menu-collapse-all',
        onSelect: () => setExpanded(new Map(rows.filter((r) => r.expandable).map((r) => [r.key, false]))),
      },
      { kind: 'separator', id: 'sep-new' },
      {
        kind: 'item',
        id: 'emptyGroup',
        label: 'Create Empty Group',
        testId: 'outliner-menu-empty-group',
        onSelect: () => void run('scene.group', { ids: [] }, { panel: PANEL_KIND }),
      },
    ];
    if (row?.kind === 'asset') {
      menu.open(event, row.name, [
        {
          kind: 'item',
          id: 'makeEditable',
          label: 'Make Editable',
          testId: 'outliner-menu-make-editable',
          onSelect: () => makeEditable(row),
        },
      ]);
      return;
    }
    if (row?.kind === 'plane') {
      const p = row.plane;
      setSelectedPlane(app, p.id);
      menu.open(event, p.name, [
        {
          kind: 'item',
          id: 'rename',
          label: 'Rename',
          testId: 'outliner-menu-rename',
          onSelect: () => setRenaming(p.id),
        },
        {
          kind: 'item',
          id: 'lock',
          label: p.locked ? 'Unlock' : 'Lock',
          testId: 'outliner-menu-lock',
          onSelect: () => void run('imagePlane.set', { id: p.id, patch: { locked: !p.locked } }, { panel: PANEL_KIND }),
        },
        {
          kind: 'item',
          id: 'visible',
          label: p.visible ? 'Hide' : 'Show',
          testId: 'outliner-menu-visible',
          onSelect: () =>
            void run('imagePlane.set', { id: p.id, patch: { visible: !p.visible } }, { panel: PANEL_KIND }),
        },
        { kind: 'separator', id: 'sep' },
        {
          kind: 'item',
          id: 'delete',
          label: 'Delete',
          testId: 'outliner-menu-delete',
          onSelect: () => void run('imagePlane.delete', { id: p.id }, { panel: PANEL_KIND }),
        },
      ]);
      return;
    }
    if (row?.kind !== 'object') {
      menu.open(event, 'Outliner', viewEntries);
      return;
    }
    const ids = targetsOf(row);
    if (!selectedSet.has(row.object.id)) void selectObjects(app, run, ids, 'replace', PANEL_KIND);
    const asset = 'source' in row.object && row.object.source !== null;
    menu.open(event, row.object.name, [
      {
        kind: 'item',
        id: 'makeEditable',
        label: 'Make Editable',
        disabled: true,
        title: asset ? 'This mesh is already editable' : 'Authored meshes are editable',
        onSelect: () => {},
      },
      {
        kind: 'item',
        id: 'rename',
        label: 'Rename',
        testId: 'outliner-menu-rename',
        onSelect: () => setRenaming(row.object.id),
      },
      {
        kind: 'item',
        id: 'duplicate',
        label: 'Duplicate',
        testId: 'outliner-menu-duplicate',
        onSelect: () => void run('scene.duplicate', { ids }, { panel: PANEL_KIND }),
      },
      {
        kind: 'item',
        id: 'group',
        label: 'Group',
        testId: 'outliner-menu-group',
        onSelect: () => void run('scene.group', { ids }, { panel: PANEL_KIND }),
      },
      {
        kind: 'item',
        id: 'isolate',
        label: 'Isolate',
        testId: 'outliner-menu-isolate',
        onSelect: () => void run('view.isolate', undefined, { panel: PANEL_KIND }),
      },
      {
        kind: 'item',
        id: 'centerPivot',
        label: 'Center Pivot',
        testId: 'outliner-menu-center-pivot',
        onSelect: () => void run('mesh.pivot.center', { ids }, { panel: PANEL_KIND }),
      },
      {
        kind: 'item',
        id: 'meshCheck',
        label: 'Mesh Check',
        testId: 'outliner-menu-mesh-check',
        onSelect: () => void run('workspace.showPanel', { panel: 'meshCheck' }, { panel: PANEL_KIND }),
      },
      { kind: 'separator', id: 'sep-export' },
      {
        kind: 'item',
        id: 'export',
        label: 'Export Selected…',
        testId: 'outliner-menu-export',
        onSelect: () => void run('ui.open', { dialog: 'export' }, { panel: PANEL_KIND }),
      },
      { kind: 'separator', id: 'sep-view' },
      ...viewEntries,
    ]);
  };

  // ---------- drag to reparent (Model only) ----------
  const onDragStart = (row: ModelOutlinerRow, event: DragEvent<HTMLElement>): void => {
    if (row.kind !== 'object') return;
    const ids = targetsOf(row);
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    event.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (row: ModelOutlinerRow, event: DragEvent<HTMLElement>): void => {
    if (dropTargetOf(row) === null || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropKey(row.key);
  };
  const onDrop = (row: ModelOutlinerRow, event: DragEvent<HTMLElement>): void => {
    setDropKey(null);
    const target = dropTargetOf(row);
    const raw = event.dataTransfer.getData(DRAG_TYPE);
    if (target === null || raw === '') return;
    event.preventDefault();
    let ids: string[];
    try {
      ids = (JSON.parse(raw) as unknown[]).filter((id): id is string => typeof id === 'string');
    } catch {
      return;
    }
    if (target.parent === null) void run('scene.unparent', { ids }, { panel: PANEL_KIND });
    else {
      const moving = ids.filter((id) => id !== target.parent);
      if (moving.length > 0) void run('scene.parent', { ids: moving, parent: target.parent }, { panel: PANEL_KIND });
    }
  };

  // ---------- keyboard (ARIA tree) ----------
  // A focused row that left the tree (deleted, filtered out) counts as no focus.
  const focusIndex = focusKey === null ? -1 : (indexByKey.get(focusKey) ?? -1);
  const focusRow = (index: number): void => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (row !== undefined) setFocusKey(row.key);
  };
  const onTreeKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.target instanceof HTMLInputElement) return;
    const row = focusIndex === -1 ? undefined : rows[focusIndex];
    switch (event.key) {
      case 'ArrowDown':
        focusRow(focusIndex + 1);
        break;
      case 'ArrowUp':
        focusRow(focusIndex === -1 ? 0 : focusIndex - 1);
        break;
      case 'ArrowRight':
        if (row === undefined) focusRow(0);
        else if (row.expandable && !row.expanded) toggle(row);
        else focusRow(focusIndex + 1);
        break;
      case 'ArrowLeft':
        if (row === undefined) break;
        if (row.expandable && row.expanded) toggle(row);
        else if (row.parent !== null) focusRow(indexByKey.get(row.parent) ?? focusIndex);
        break;
      case 'F2':
      case 'Enter': {
        // §8.8: Rename is F2 / Enter on an object or plane row.
        const id = row === undefined ? null : rowId(row);
        if (row === undefined || id === null || row.kind === 'asset') return;
        setRenaming(id);
        break;
      }
      case ' ':
        if (row === undefined) return;
        activate(row, event);
        break;
      case 'Delete':
      case 'Backspace': {
        if (row?.kind === 'plane') void run('imagePlane.delete', { id: row.plane.id }, { panel: PANEL_KIND });
        else if (row?.kind === 'object') void run('scene.delete', { ids: targetsOf(row) }, { panel: PANEL_KIND });
        else return;
        break;
      }
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const empty = rows.length === 1 && doc.roots.length === 0;
  return (
    <div className={PANEL_ROOT} style={PANEL_ROOT_STYLE} data-testid="outliner-panel" data-instance={instanceId}>
      <div className={TOOLBAR}>
        <input
          type="search"
          className={`${INPUT} h-[22px] min-w-0 flex-1`}
          placeholder="Filter: object name…"
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
            }
          }}
        />
        <button
          type="button"
          className={BUTTON}
          title="Create an empty group"
          data-testid="outliner-new-group"
          onClick={() => void run('scene.group', { ids: [] }, { panel: PANEL_KIND })}
        >
          + Group
        </button>
      </div>
      <div
        ref={treeRef}
        role="tree"
        aria-label="Outliner"
        aria-multiselectable="true"
        tabIndex={0}
        className="group min-h-0 flex-1 overflow-auto outline-none"
        data-testid="outliner-tree"
        onKeyDown={onTreeKeyDown}
        onContextMenu={(event) => openMenu(null, event)}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDropKey(null);
        }}
      >
        {rows.map((row) => {
          const id = rowId(row);
          const selectedRow =
            (row.kind === 'object' && selectedSet.has(row.object.id)) ||
            (row.kind === 'plane' && row.plane.id === plane);
          return (
            <ModelRowView
              key={row.key}
              app={app}
              row={row}
              selected={selectedRow}
              hilited={row.kind === 'object' && mode !== 'object' && hiliteSet.has(row.object.id)}
              hidden={id !== null && hidden.has(id as SceneObjectId)}
              lead={row.kind === 'object' && row.object.id === lead}
              focused={focusIndex !== -1 && row.key === focusKey}
              dropTarget={row.key === dropKey}
              renaming={id !== null && id === renaming}
              symmetry={row.kind === 'object' && !isGroup(row.object) ? symmetry.get(row.object.id) : undefined}
              onActivate={(event) => {
                treeRef.current?.focus({ preventScroll: true });
                activate(row, event);
              }}
              onToggle={() => toggle(row)}
              onMenu={(event) => openMenu(row, event)}
              onKeyDown={onTreeKeyDown}
              onRenamed={(name) => {
                setRenaming(null);
                treeRef.current?.focus({ preventScroll: true });
                if (name === null) return;
                if (row.kind === 'plane') {
                  void run('imagePlane.set', { id: row.plane.id, patch: { name } }, { panel: PANEL_KIND });
                } else if (row.kind === 'object') {
                  void run('scene.rename', { id: row.object.id, name }, { panel: PANEL_KIND });
                }
              }}
              onStartRename={() => {
                if (id !== null) setRenaming(id);
              }}
              onMakeEditable={row.kind === 'asset' ? () => makeEditable(row) : undefined}
              onDragStart={(event) => onDragStart(row, event)}
              onDragOver={(event) => onDragOver(row, event)}
              onDrop={(event) => onDrop(row, event)}
            />
          );
        })}
        {empty ? (
          <div className={`${EMPTY_STATE} py-6`} data-testid="outliner-empty">
            <p>
              Nothing here yet. <span className="text-fg-2">Shift+RMB</span> on empty space creates primitives.
            </p>
          </div>
        ) : null}
      </div>
      {menu.element}
    </div>
  );
}

interface RowViewProps {
  readonly app: EditorApp;
  readonly row: ModelOutlinerRow;
  readonly selected: boolean;
  readonly hilited: boolean;
  readonly hidden: boolean;
  readonly lead: boolean;
  readonly focused: boolean;
  readonly dropTarget: boolean;
  readonly renaming: boolean;
  readonly symmetry: SymmetrySettings | undefined;
  readonly onActivate: (event: MouseEvent) => void;
  readonly onToggle: () => void;
  readonly onMenu: (event: MouseEvent) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onRenamed: (name: string | null) => void;
  readonly onStartRename: () => void;
  readonly onMakeEditable: (() => void) | undefined;
  readonly onDragStart: (event: DragEvent<HTMLElement>) => void;
  readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLElement>) => void;
}

const SECTION_LABEL = { scene: 'Scene', reference: 'Reference' } as const;
const CAMERA_LABEL = { front: 'Front', side: 'Side', top: 'Top' } as const;

function ModelRowView(props: RowViewProps): JSX.Element {
  const { app, row } = props;
  const id = rowId(row);
  const testId =
    id !== null
      ? `outliner-row-${id}`
      : row.kind === 'section'
        ? `outliner-section-${row.section}`
        : row.kind === 'character'
          ? `outliner-character-${row.character.id}`
          : `outliner-meshes-${row.kind === 'meshes' ? row.character : ''}`;
  const draggable = row.kind === 'object';
  return (
    <div
      role="treeitem"
      tabIndex={-1}
      aria-level={row.depth + 1}
      aria-expanded={row.expandable ? row.expanded : undefined}
      aria-selected={row.kind === 'object' || row.kind === 'plane' ? props.selected : undefined}
      data-testid={testId}
      data-lead={props.lead ? 'true' : undefined}
      data-hilite={props.hilited ? 'true' : undefined}
      data-focused={props.focused ? 'true' : undefined}
      draggable={draggable}
      className={
        'relative flex cursor-default items-center gap-1 pr-2 whitespace-nowrap ' +
        `${props.selected ? ROW_SELECTED : ROW_HOVER} ` +
        (props.focused ? 'group-focus:shadow-[inset_0_0_0_1px_var(--accent-text,#a996ff)] ' : '') +
        (props.dropTarget ? 'shadow-[inset_0_0_0_1px_var(--accent-text,#a996ff)] ' : '') +
        (props.hidden ? 'opacity-50' : '')
      }
      style={{ height: ROW_HEIGHT, paddingLeft: 4 + row.depth * INDENT }}
      onClick={props.onActivate}
      onDoubleClick={() => {
        if (row.kind === 'object' || row.kind === 'plane') props.onStartRename();
      }}
      onContextMenu={props.onMenu}
      onKeyDown={props.onKeyDown}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
    >
      {props.lead ? (
        <span className="absolute top-0.5 bottom-0.5 left-0 w-[3px] rounded-r" style={{ background: SEL_LEAD_COLOR }} />
      ) : null}
      {props.hilited ? (
        <span
          className="absolute top-0.5 bottom-0.5 left-0 w-[3px] rounded-r bg-[var(--comp-selected,#ffa31a)]"
          title="Hilited (component mode)"
        />
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
      <RowContent {...props} />
      {row.kind === 'object' && !isGroup(row.object) ? (
        <Badges id={row.object.id} badges={meshBadges(app, row.object, props.symmetry)} />
      ) : null}
    </div>
  );
}

function RowContent(props: RowViewProps): JSX.Element {
  const { row } = props;
  const name = (text: string, strong = false): JSX.Element =>
    props.renaming ? (
      <RenameInput initial={text} onDone={props.onRenamed} />
    ) : (
      <span className={`min-w-0 truncate ${strong ? 'font-semibold' : ''}`}>{text}</span>
    );
  switch (row.kind) {
    case 'section':
      return (
        <>
          {name(SECTION_LABEL[row.section], true)}
          <span className="text-fg-3">({row.count})</span>
        </>
      );
    case 'character':
      return (
        <>
          <span className="text-fg-2">
            <CharacterIcon />
          </span>
          {name(row.character.name, true)}
        </>
      );
    case 'meshes':
      return (
        <>
          <span className="min-w-0 truncate text-fg-2">Meshes</span>
          {row.loaded ? null : <span className="text-fg-3">(not loaded)</span>}
        </>
      );
    case 'object':
      return (
        <>
          <span className="w-3 text-center text-fg-3" aria-hidden="true">
            {isGroup(row.object) ? '⊞' : '▢'}
          </span>
          {name(row.object.name)}
          {isGroup(row.object) &&
          row.object.template !== null &&
          !row.object.name.toLowerCase().includes(row.object.template.kind) ? (
            <span className="text-fg-3" title={`${row.object.template.kind} template`}>
              {row.object.template.kind}
            </span>
          ) : null}
        </>
      );
    case 'asset':
      return (
        <>
          <span className="w-3 text-center text-fg-3" aria-hidden="true">
            ▢
          </span>
          <span className="min-w-0 truncate">{row.name}</span>
          <span
            className="ml-auto flex shrink-0 items-center gap-1 pl-1 text-fg-3"
            data-testid={`outliner-badge-${row.id}`}
          >
            {row.tris === null ? null : (
              <span className="ekza-numeric" title={`${row.tris} triangles`}>
                {row.tris} tris
              </span>
            )}
            <span
              className="rounded-[3px] px-1 text-[10px] leading-4"
              title="Imported asset: read-only until made editable"
            >
              ⊘ asset
            </span>
            {row.skinned ? (
              <span className="rounded-[3px] px-1 text-[10px] leading-4" title="Skinned to the character's skeleton">
                skin
              </span>
            ) : null}
            <button
              type="button"
              className={`${BUTTON} h-5`}
              title="Convert this glTF mesh into editable mesh data (one undo step)"
              data-testid={`outliner-make-editable-${row.id}`}
              onClick={(event) => {
                event.stopPropagation();
                props.onMakeEditable?.();
              }}
            >
              Make editable
            </button>
          </span>
        </>
      );
    case 'plane':
      return (
        <>
          <span className="w-3 text-center text-fg-3" aria-hidden="true">
            ▣
          </span>
          {name(row.plane.name)}
          <span
            className="ml-auto flex shrink-0 items-center gap-1 pl-1 text-fg-3"
            data-testid={`outliner-badge-${row.plane.id}`}
          >
            <span title={`Shown in the ${row.plane.camera} view`}>{CAMERA_LABEL[row.plane.camera]}</span>
            {row.plane.locked ? <span title="Locked">🔒</span> : null}
            {row.plane.visible ? null : <span title="Hidden">hidden</span>}
          </span>
        </>
      );
  }
}

function RenameInput(props: { readonly initial: string; readonly onDone: (name: string | null) => void }): JSX.Element {
  const [value, setValue] = useState(props.initial);
  const done = useRef(false);
  const finish = (name: string | null): void => {
    if (done.current) return;
    done.current = true;
    props.onDone(name === null || name.trim() === '' || name === props.initial ? null : name);
  };
  return (
    <input
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- inline rename takes the focus it was opened for
      autoFocus
      type="text"
      className={`${INPUT} h-5 min-w-0 flex-1`}
      value={value}
      aria-label="Name"
      data-testid="outliner-rename"
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(value);
        else if (event.key === 'Escape') finish(null);
      }}
    />
  );
}
