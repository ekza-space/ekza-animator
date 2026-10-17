// Outliner tree model (FR-OUT-01/02): Character → Rig (control hierarchy) / Skeleton (read-only bones with VRM
// humanoid names) / Clips, flattened into the visible rows of a virtualized list. Pure functions of document
// records, runtime skeletons and view state.
import type {
  BoneRef,
  CharacterId,
  CharacterRecord,
  ClipId,
  ClipRecord,
  ControlId,
  ControlRecord,
  DocumentStore,
  HumanBoneName,
} from '@ekza-animator/doc';
import type { SkeletonDesc } from '@ekza-animator/rig';

export interface OutlinerCharacter {
  readonly record: CharacterRecord;
  /** `controlsOfRig` order: parents before children, then by `order`. */
  readonly controls: readonly ControlRecord[];
  readonly clips: readonly ClipRecord[];
}

export interface OutlinerDoc {
  readonly characters: readonly OutlinerCharacter[];
}

export function readOutlinerDoc(store: DocumentStore): OutlinerDoc {
  const characters = [...store.list('characters')].sort(byOrder).map((record) => {
    const rig = store.get('rigs', record.rig) ?? store.query.rigOfCharacter(record.id);
    return {
      record,
      controls: rig === undefined ? [] : store.query.controlsOfRig(rig.id),
      clips: store.query.clipsOfCharacter(record.id),
    };
  });
  return { characters };
}

function byOrder(
  a: { readonly order: string; readonly id: string },
  b: { readonly order: string; readonly id: string },
) {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type GroupKind = 'rig' | 'skeleton' | 'clips';

interface RowBase {
  /** Stable key: `chr:<id>`, `grp:<characterId>:<group>`, `ctl:<id>`, `bone:<characterId>:<node>`, `clip:<id>`. */
  readonly key: string;
  readonly parent: string | null;
  readonly depth: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
  /** The row itself matched the filter (ancestors shown for context do not). */
  readonly match: boolean;
}

export type OutlinerRow =
  | (RowBase & { readonly kind: 'character'; readonly character: CharacterRecord; readonly active: boolean })
  | (RowBase & {
      readonly kind: 'group';
      readonly character: CharacterId;
      readonly group: GroupKind;
      /** Items in the group (unfiltered); null while the character's skeleton is not loaded. */
      readonly count: number | null;
    })
  | (RowBase & {
      readonly kind: 'control';
      readonly character: CharacterId;
      readonly control: ControlRecord;
      readonly humanoid: HumanBoneName | null;
      /** Hidden for this user (`session.hiddenControls`). */
      readonly hidden: boolean;
    })
  | (RowBase & {
      readonly kind: 'bone';
      readonly character: CharacterId;
      readonly node: number;
      readonly name: string;
      readonly humanoid: HumanBoneName | null;
      /** The control whose binding drives this bone, if any. */
      readonly control: ControlId | null;
    })
  | (RowBase & {
      readonly kind: 'clip';
      readonly character: CharacterId;
      readonly clip: ClipRecord;
      readonly active: boolean;
    });

export interface OutlinerView {
  /** Free text; matches names, template keys, VRM humanoid names, bone and clip names (case-insensitive). */
  readonly filter: string;
  readonly showSecondary: boolean;
  readonly hiddenControls: ReadonlySet<ControlId>;
  /** Explicit expand/collapse choices by row key; other rows use `defaultExpanded`. */
  readonly expanded: ReadonlyMap<string, boolean>;
  readonly skeletons: ReadonlyMap<CharacterId, SkeletonDesc>;
  readonly activeCharacter: CharacterId | null;
  readonly activeClip: Readonly<Record<CharacterId, ClipId>>;
}

export const characterKey = (id: CharacterId): string => `chr:${id}`;
export const groupKey = (id: CharacterId, group: GroupKind): string => `grp:${id}:${group}`;
export const controlKey = (id: ControlId): string => `ctl:${id}`;
export const boneKey = (character: CharacterId, node: number): string => `bone:${character}:${node}`;
export const clipKey = (id: ClipId): string => `clip:${id}`;

/** Everything starts expanded except the (long, read-only) skeleton. */
export function defaultExpanded(key: string): boolean {
  return !(key.startsWith('grp:') && key.endsWith(':skeleton'));
}

/** Secondary controls (spring/accessory joints) are hidden unless `showSecondary`. */
export function isSecondary(control: ControlRecord): boolean {
  return control.hiddenByDefault || control.group === 'secondary';
}

/** The VRM humanoid bone a control drives, if any. */
export function humanoidOf(control: ControlRecord): HumanBoneName | null {
  const bone = control.drives?.bone;
  return bone !== undefined && 'humanoid' in bone ? bone.humanoid : null;
}

/** Resolves a semantic bone reference to a SkeletonDesc node index (-1 when absent). */
export function resolveBone(skeleton: SkeletonDesc, ref: BoneRef): number {
  if ('humanoid' in ref) return skeleton.humanoid?.[ref.humanoid] ?? -1;
  let seen = 0;
  for (const node of skeleton.nodes) {
    const parentName = node.parent === -1 ? null : (skeleton.nodes[node.parent]?.name ?? null);
    if (node.name !== ref.name || parentName !== ref.parentName) continue;
    if (seen === (ref.occurrence ?? 0)) return node.index;
    seen++;
  }
  return -1;
}

const matches = (query: string, ...texts: readonly (string | null | undefined)[]): boolean =>
  texts.some((text) => text !== null && text !== undefined && text.toLowerCase().includes(query));

/** A node of one of the character's two trees, before flattening. */
interface TreeNode<T> {
  readonly key: string;
  readonly item: T;
  readonly children: TreeNode<T>[];
  readonly match: boolean;
}

/**
 * Builds trees from items listed parents-first. `parentOf` gives the nearest *shown* parent item (null: root);
 * with a query, only matching items and their ancestors are kept.
 */
function buildTree<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  parentOf: (item: T) => T | null,
  isMatch: ((item: T) => boolean) | null,
): TreeNode<T>[] {
  const nodes = new Map<T, TreeNode<T>>();
  for (const item of items) nodes.set(item, { key: keyOf(item), item, children: [], match: isMatch?.(item) ?? false });
  const roots: TreeNode<T>[] = [];
  for (const item of items) {
    const node = nodes.get(item);
    if (node === undefined) continue;
    const parent = parentOf(item);
    const parentNode = parent === null ? undefined : nodes.get(parent);
    if (parentNode === undefined) roots.push(node);
    else parentNode.children.push(node);
  }
  if (isMatch === null) return roots;
  const prune = (list: TreeNode<T>[]): TreeNode<T>[] =>
    list.filter((node) => {
      node.children.splice(0, node.children.length, ...prune(node.children));
      return node.match || node.children.length > 0;
    });
  return prune(roots);
}

interface CharacterTrees {
  readonly controls: TreeNode<ControlRecord>[];
  readonly controlCount: number;
  readonly bones: TreeNode<number>[] | null;
  readonly boneCount: number | null;
  readonly clips: readonly ClipRecord[];
  readonly boneControl: ReadonlyMap<number, ControlId>;
  readonly boneHumanoid: ReadonlyMap<number, HumanBoneName>;
  readonly skeleton: SkeletonDesc | null;
}

function characterTrees(entry: OutlinerCharacter, view: OutlinerView, query: string): CharacterTrees {
  const byId = new Map(entry.controls.map((control) => [control.id, control]));
  const shown = entry.controls.filter((control) => view.showSecondary || !isSecondary(control));
  const shownIds = new Set(shown.map((control) => control.id));
  const shownParent = (control: ControlRecord): ControlRecord | null => {
    const seen = new Set<ControlId>();
    for (let id = control.parent; id !== null && !seen.has(id); ) {
      seen.add(id);
      const parent = byId.get(id);
      if (parent === undefined) return null;
      if (shownIds.has(id)) return parent;
      id = parent.parent;
    }
    return null;
  };

  const skeleton = view.skeletons.get(entry.record.id) ?? null;
  const boneHumanoid = new Map<number, HumanBoneName>();
  const boneControl = new Map<number, ControlId>();
  let bones: TreeNode<number>[] | null = null;
  let boneCount: number | null = null;
  if (skeleton !== null) {
    for (const [name, node] of Object.entries(skeleton.humanoid ?? {})) {
      if (node !== undefined) boneHumanoid.set(node, name as HumanBoneName);
    }
    for (const control of entry.controls) {
      if (control.drives === null) continue;
      const node = resolveBone(skeleton, control.drives.bone);
      if (node !== -1 && !boneControl.has(node)) boneControl.set(node, control.id);
    }
    const shownNodes = skeleton.nodes.filter((node) => node.isJoint || boneHumanoid.has(node.index));
    const shownSet = new Set(shownNodes.map((node) => node.index));
    const boneParent = (index: number): number | null => {
      for (let p = skeleton.nodes[index]?.parent ?? -1; p !== -1; p = skeleton.nodes[p]?.parent ?? -1) {
        if (shownSet.has(p)) return p;
      }
      return null;
    };
    boneCount = shownNodes.length;
    bones = buildTree(
      shownNodes.map((node) => node.index),
      (index) => boneKey(entry.record.id, index),
      boneParent,
      query === '' ? null : (index) => matches(query, skeleton.nodes[index]?.name, boneHumanoid.get(index)),
    );
  }

  return {
    controls: buildTree(
      shown,
      (control) => controlKey(control.id),
      shownParent,
      query === ''
        ? null
        : (control) =>
            matches(
              query,
              control.name,
              control.key,
              humanoidOf(control),
              control.drives !== null && 'name' in control.drives.bone ? control.drives.bone.name : null,
            ),
    ),
    controlCount: shown.length,
    bones,
    boneCount,
    clips: query === '' ? entry.clips : entry.clips.filter((clip) => matches(query, clip.name)),
    boneControl,
    boneHumanoid,
    skeleton,
  };
}

/** The visible rows, top to bottom. */
export function buildOutlinerRows(doc: OutlinerDoc, view: OutlinerView): OutlinerRow[] {
  const rows: OutlinerRow[] = [];
  const filter = view.filter.trim().toLowerCase();
  const isExpanded = (key: string): boolean => filter !== '' || (view.expanded.get(key) ?? defaultExpanded(key));

  for (const entry of doc.characters) {
    const character = entry.record;
    const characterMatch = filter !== '' && matches(filter, character.name);
    // A matching character shows its whole content; otherwise only matching items (and their ancestors) show.
    const query = characterMatch ? '' : filter;
    const trees = characterTrees(entry, view, query);
    const groups: { readonly group: GroupKind; readonly visible: boolean; readonly count: number | null }[] = [
      { group: 'rig', visible: trees.controls.length > 0 || query === '', count: trees.controlCount },
      { group: 'skeleton', visible: (trees.bones?.length ?? 0) > 0 || query === '', count: trees.boneCount },
      { group: 'clips', visible: trees.clips.length > 0 || query === '', count: entry.clips.length },
    ];
    if (filter !== '' && !characterMatch && !groups.some((group) => group.visible)) continue;

    const chrKey = characterKey(character.id);
    const chrExpanded = filter !== '' ? true : (view.expanded.get(chrKey) ?? defaultExpanded(chrKey));
    rows.push({
      kind: 'character',
      key: chrKey,
      parent: null,
      depth: 0,
      expandable: true,
      expanded: chrExpanded,
      match: characterMatch,
      character,
      active: view.activeCharacter === character.id,
    });
    if (!chrExpanded) continue;

    for (const { group, visible, count } of groups) {
      if (!visible) continue;
      const key = groupKey(character.id, group);
      const hasChildren =
        group === 'rig'
          ? trees.controls.length > 0
          : group === 'skeleton'
            ? (trees.bones?.length ?? 0) > 0
            : trees.clips.length > 0;
      const expanded = isExpanded(key);
      rows.push({
        kind: 'group',
        key,
        parent: chrKey,
        depth: 1,
        expandable: hasChildren,
        expanded,
        match: false,
        character: character.id,
        group,
        count,
      });
      if (!expanded) continue;
      if (group === 'rig') {
        const walk = (nodes: readonly TreeNode<ControlRecord>[], parent: string, depth: number): void => {
          for (const node of nodes) {
            const open = isExpanded(node.key);
            rows.push({
              kind: 'control',
              key: node.key,
              parent,
              depth,
              expandable: node.children.length > 0,
              expanded: open,
              match: node.match,
              character: character.id,
              control: node.item,
              humanoid: humanoidOf(node.item),
              hidden: view.hiddenControls.has(node.item.id),
            });
            if (open) walk(node.children, node.key, depth + 1);
          }
        };
        walk(trees.controls, key, 2);
      } else if (group === 'skeleton') {
        const walk = (nodes: readonly TreeNode<number>[], parent: string, depth: number): void => {
          for (const node of nodes) {
            const open = isExpanded(node.key);
            rows.push({
              kind: 'bone',
              key: node.key,
              parent,
              depth,
              expandable: node.children.length > 0,
              expanded: open,
              match: node.match,
              character: character.id,
              node: node.item,
              name: trees.skeleton?.nodes[node.item]?.name ?? '',
              humanoid: trees.boneHumanoid.get(node.item) ?? null,
              control: trees.boneControl.get(node.item) ?? null,
            });
            if (open) walk(node.children, node.key, depth + 1);
          }
        };
        walk(trees.bones ?? [], key, 2);
      } else {
        for (const clip of trees.clips) {
          rows.push({
            kind: 'clip',
            key: clipKey(clip.id),
            parent: key,
            depth: 2,
            expandable: false,
            expanded: false,
            match: query !== '',
            character: character.id,
            clip,
            active: view.activeClip[character.id] === clip.id,
          });
        }
      }
    }
  }
  return rows;
}

/** The control and its shown descendants, parents first ("Select Hierarchy"). */
export function controlHierarchy(
  controls: readonly ControlRecord[],
  roots: readonly ControlId[],
  showSecondary: boolean,
): ControlId[] {
  const children = new Map<ControlId | null, ControlRecord[]>();
  for (const control of controls) {
    const list = children.get(control.parent);
    if (list === undefined) children.set(control.parent, [control]);
    else list.push(control);
  }
  const out: ControlId[] = [];
  const seen = new Set<ControlId>();
  const visit = (id: ControlId): void => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    for (const child of children.get(id) ?? []) {
      if (showSecondary || !isSecondary(child)) visit(child.id);
    }
  };
  for (const id of roots) visit(id);
  return out;
}

/** Row keys that must be expanded for a control's row to be visible (outermost first). */
export function revealKeys(doc: OutlinerDoc, control: ControlId): string[] {
  for (const entry of doc.characters) {
    const byId = new Map(entry.controls.map((record) => [record.id, record]));
    const record = byId.get(control);
    if (record === undefined) continue;
    const ancestors: string[] = [];
    const seen = new Set<ControlId>();
    for (let id = record.parent; id !== null && !seen.has(id); id = byId.get(id)?.parent ?? null) {
      seen.add(id);
      ancestors.unshift(controlKey(id));
    }
    return [characterKey(entry.record.id), groupKey(entry.record.id, 'rig'), ...ancestors];
  }
  return [];
}
