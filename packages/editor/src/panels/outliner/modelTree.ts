// The Model Outliner's tree (M6A-SPEC §8.8, §5.21; research 16 §13; B13): Scene › groups and meshes (props) in their
// parent hierarchy, each character › Meshes (its glTF meshes in glTF order: the record once made editable, else a
// `⊘ asset` row with the inline Make editable button; then the character's authored meshes), Reference › image
// planes. Pure functions of the document, the loaded containers and the view state, flattened into visible rows.
import type {
  CharacterId,
  CharacterRecord,
  DocumentStore,
  GroupRecord,
  ImagePlaneRecord,
  MeshId,
  MeshOwner,
  MeshRecord,
} from '@ekza-studio/doc';
import { assetMeshId } from '@ekza-studio/editor-core';

export type SceneObjectRecord = MeshRecord | GroupRecord;

/** A loaded character's glTF meshes as the Outliner shows them (from its container). */
export interface ContainerMeshes {
  readonly names: readonly string[];
  /** Triangles per glTF mesh (triangle-list primitives: indices or positions ÷ 3), null when unknown. */
  readonly tris: readonly (number | null)[];
  readonly skinned: readonly boolean[];
}

export interface ModelOutlinerDoc {
  readonly roots: readonly SceneObjectRecord[];
  readonly children: ReadonlyMap<string, readonly SceneObjectRecord[]>;
  readonly characters: readonly {
    readonly record: CharacterRecord;
    /** Authored roots owned by the character (not glTF meshes), e.g. Duplicate Face copies. */
    readonly roots: readonly SceneObjectRecord[];
  }[];
  readonly planes: readonly ImagePlaneRecord[];
  readonly store: DocumentStore;
}

const byOrder = (
  a: { readonly order: string; readonly id: string },
  b: { readonly order: string; readonly id: string },
): number => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const ownerKeyOf = (owner: MeshOwner): CharacterId | 'scene' => ('scene' in owner ? 'scene' : owner.character);

export function readModelOutlinerDoc(store: DocumentStore): ModelOutlinerDoc {
  const children = new Map<string, readonly SceneObjectRecord[]>();
  const walk = (owner: CharacterId | 'scene', list: readonly SceneObjectRecord[]): void => {
    for (const object of list) {
      const kids = store.query.childrenOf(object.id, owner);
      if (kids.length === 0) continue;
      children.set(object.id, kids);
      walk(owner, kids);
    }
  };
  const roots = store.query.childrenOf(null, 'scene');
  walk('scene', roots);
  const characters = [...store.list('characters')].sort(byOrder).map((record) => {
    const owned = store.query.childrenOf(null, record.id);
    walk(record.id, owned);
    return { record, roots: owned };
  });
  return { roots, children, characters, planes: [...store.list('imagePlanes')].sort(byOrder), store };
}

/** The glTF meshes of a container JSON (names, triangle counts, skinned flags). */
export function containerMeshes(json: Readonly<Record<string, unknown>>): ContainerMeshes {
  const meshes = Array.isArray(json['meshes']) ? (json['meshes'] as unknown[]) : [];
  const accessors = Array.isArray(json['accessors']) ? (json['accessors'] as unknown[]) : [];
  const nodes = Array.isArray(json['nodes']) ? (json['nodes'] as unknown[]) : [];
  const countOf = (index: unknown): number | null => {
    if (typeof index !== 'number') return null;
    const accessor = accessors[index] as { count?: unknown } | undefined;
    return typeof accessor?.count === 'number' ? accessor.count : null;
  };
  const skinned = meshes.map(() => false);
  for (const node of nodes) {
    const n = node as { mesh?: unknown; skin?: unknown } | null;
    if (n !== null && typeof n.mesh === 'number' && typeof n.skin === 'number' && n.mesh < skinned.length) {
      skinned[n.mesh] = true;
    }
  }
  const names: string[] = [];
  const tris: (number | null)[] = [];
  meshes.forEach((mesh, index) => {
    const m = (mesh ?? {}) as { name?: unknown; primitives?: unknown };
    names.push(typeof m.name === 'string' && m.name.trim() !== '' ? m.name : `Mesh ${index}`);
    let total: number | null = 0;
    for (const primitive of Array.isArray(m.primitives) ? (m.primitives as unknown[]) : []) {
      const p = (primitive ?? {}) as { mode?: unknown; indices?: unknown; attributes?: { POSITION?: unknown } };
      if (p.mode !== undefined && p.mode !== 4) continue;
      const count = p.indices === undefined ? countOf(p.attributes?.POSITION) : countOf(p.indices);
      if (count === null || total === null) {
        total = null;
        continue;
      }
      total += Math.floor(count / 3);
    }
    tris.push(total);
  });
  return { names, tris, skinned };
}

interface RowBase {
  readonly key: string;
  readonly parent: string | null;
  readonly depth: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
}

export type ModelOutlinerRow =
  | (RowBase & { readonly kind: 'section'; readonly section: 'scene' | 'reference'; readonly count: number })
  | (RowBase & { readonly kind: 'object'; readonly object: SceneObjectRecord })
  | (RowBase & { readonly kind: 'character'; readonly character: CharacterRecord })
  | (RowBase & { readonly kind: 'meshes'; readonly character: CharacterId; readonly loaded: boolean })
  | (RowBase & {
      readonly kind: 'asset';
      readonly id: MeshId;
      readonly character: CharacterId;
      readonly meshIndex: number;
      readonly name: string;
      readonly tris: number | null;
      readonly skinned: boolean;
    })
  | (RowBase & { readonly kind: 'plane'; readonly plane: ImagePlaneRecord });

export interface ModelOutlinerView {
  readonly filter: string;
  readonly expanded: ReadonlyMap<string, boolean>;
  /** Loaded characters' glTF meshes (absent: not loaded yet). */
  readonly containers: ReadonlyMap<CharacterId, ContainerMeshes>;
}

export const SCENE_KEY = 'section:scene';
export const REFERENCE_KEY = 'section:reference';
export const objectKey = (id: string): string => `obj:${id}`;
export const characterKey = (id: CharacterId): string => `chr:${id}`;
export const meshesKey = (id: CharacterId): string => `meshes:${id}`;
export const assetKey = (id: MeshId): string => `asset:${id}`;
export const planeKey = (id: string): string => `plane:${id}`;

const isGroup = (object: SceneObjectRecord): object is GroupRecord => object.id.startsWith('grp_');

/** The visible rows, top to bottom. A filter shows matching rows with their ancestors, everything expanded. */
export function buildModelOutlinerRows(doc: ModelOutlinerDoc, view: ModelOutlinerView): ModelOutlinerRow[] {
  const query = view.filter.trim().toLowerCase();
  const matches = (name: string): boolean => query === '' || name.toLowerCase().includes(query);
  const open = (key: string): boolean => query !== '' || (view.expanded.get(key) ?? true);

  /** Whether an object or one of its descendants matches. */
  const subtreeMatches = (object: SceneObjectRecord): boolean =>
    matches(object.name) || (doc.children.get(object.id) ?? []).some(subtreeMatches);

  const rows: ModelOutlinerRow[] = [];
  const objects = (list: readonly SceneObjectRecord[], parent: string, depth: number): void => {
    for (const object of list) {
      if (!subtreeMatches(object)) continue;
      const key = objectKey(object.id);
      const kids = doc.children.get(object.id) ?? [];
      const expanded = open(key);
      rows.push({ kind: 'object', key, parent, depth, expandable: kids.length > 0, expanded, object });
      if (expanded) objects(kids, key, depth + 1);
    }
  };

  const sceneOpen = open(SCENE_KEY);
  rows.push({
    kind: 'section',
    section: 'scene',
    key: SCENE_KEY,
    parent: null,
    depth: 0,
    expandable: doc.roots.length > 0,
    expanded: sceneOpen,
    count: doc.roots.length,
  });
  if (sceneOpen) objects(doc.roots, SCENE_KEY, 1);

  for (const { record, roots } of doc.characters) {
    const container = view.containers.get(record.id);
    const assetRows: ModelOutlinerRow[] = [];
    const meshKey = meshesKey(record.id);
    const meshesOpen = open(meshKey);
    const chrKey = characterKey(record.id);
    const chrOpen = open(chrKey);
    // Only an imported (asset) character's glTF meshes are read-only asset rows; a model-sourced character's display
    // container is synthesised from its own mesh records, which are listed as objects below (M6b acceptance fix).
    if (container !== undefined && record.asset !== null && record.source?.kind !== 'model') {
      container.names.forEach((name, meshIndex) => {
        const id = assetMeshId(record.id, meshIndex);
        const made = doc.store.get('meshes', id);
        if (made !== undefined) return; // listed with the character's objects below
        if (!matches(name)) return;
        assetRows.push({
          kind: 'asset',
          key: assetKey(id),
          parent: meshKey,
          depth: 3,
          expandable: false,
          expanded: false,
          id,
          character: record.id,
          meshIndex,
          name,
          tris: container.tris[meshIndex] ?? null,
          skinned: container.skinned[meshIndex] ?? false,
        });
      });
    }
    const shownRoots = roots.filter(subtreeMatches);
    if (query !== '' && !matches(record.name) && assetRows.length === 0 && shownRoots.length === 0) continue;
    rows.push({
      kind: 'character',
      key: chrKey,
      parent: null,
      depth: 0,
      expandable: true,
      expanded: chrOpen,
      character: record,
    });
    if (!chrOpen) continue;
    rows.push({
      kind: 'meshes',
      key: meshKey,
      parent: chrKey,
      depth: 1,
      expandable: assetRows.length + shownRoots.length > 0,
      expanded: meshesOpen,
      character: record.id,
      loaded: container !== undefined,
    });
    if (!meshesOpen) continue;
    // glTF order: made-editable records take their mesh's place among the asset rows.
    const ordered: { readonly index: number; readonly row: ModelOutlinerRow | SceneObjectRecord }[] = [
      ...assetRows.map((row) => ({ index: row.kind === 'asset' ? row.meshIndex : 0, row })),
      ...shownRoots.map((object) => ({
        index: 'source' in object && object.source !== null ? object.source.mesh : Number.MAX_SAFE_INTEGER,
        row: object as ModelOutlinerRow | SceneObjectRecord,
      })),
    ].sort((a, b) => a.index - b.index);
    for (const entry of ordered) {
      if ('kind' in entry.row) rows.push(entry.row);
      else objects([entry.row], meshKey, 2);
    }
  }

  const planes = doc.planes.filter((plane) => matches(plane.name));
  if (planes.length > 0) {
    const refOpen = open(REFERENCE_KEY);
    rows.push({
      kind: 'section',
      section: 'reference',
      key: REFERENCE_KEY,
      parent: null,
      depth: 0,
      expandable: true,
      expanded: refOpen,
      count: planes.length,
    });
    if (refOpen) {
      for (const plane of planes) {
        rows.push({
          kind: 'plane',
          key: planeKey(plane.id),
          parent: REFERENCE_KEY,
          depth: 1,
          expandable: false,
          expanded: false,
          plane,
        });
      }
    }
  }
  return rows;
}

/** The row's object id for selection and test ids (objects, asset meshes' derived ids, planes), or null. */
export function rowId(row: ModelOutlinerRow): string | null {
  switch (row.kind) {
    case 'object':
      return row.object.id;
    case 'asset':
      return row.id;
    case 'plane':
      return row.plane.id;
    case 'section':
    case 'character':
    case 'meshes':
      return null;
  }
}

/** Whether a dragged object may be dropped on a row: a group or mesh of the same owner that is not its descendant. */
export function dropTargetOf(row: ModelOutlinerRow): { readonly parent: string | null; readonly owner: string } | null {
  if (row.kind === 'section' && row.section === 'scene') return { parent: null, owner: 'scene' };
  if (row.kind === 'object') return { parent: row.object.id, owner: ownerKeyOf(row.object.owner) };
  return null;
}

export { isGroup };
