// DocQueries by linear scans (the real store keeps incremental indexes; MVP-SPEC §4.2 for the projection rules).
import type {
  ChannelId,
  CharacterId,
  ClipId,
  ClipRecord,
  ControlId,
  ControlRecord,
  CurveId,
  CurveRecord,
  DocQueries,
  GroupId,
  GroupRecord,
  ImagePlaneRecord,
  JointRecord,
  KeyRecord,
  LayerId,
  LayerRecord,
  MeshId,
  MeshRecord,
  OrthoCamera,
  PaletteId,
  Partition,
  RigId,
  RigRecord,
  SkeletonId,
  SwatchRecord,
} from '@ekza-animator/doc';
import type { RowView } from './layers';
import { byOrderThenId, compareStrings } from './rows';

export function createQueries(view: RowView): DocQueries {
  const curves = (): CurveRecord[] => view.list('curves') as unknown as CurveRecord[];
  const sameChannel = (a: CurveRecord, b: CurveRecord): boolean =>
    a.clip === b.clip && a.layer === b.layer && a.control === b.control && a.channel === b.channel;
  /** Smallest CurveId of a channel's duplicates; `list` is id-ordered, so the first match. */
  const canonical = (curve: CurveRecord, all: readonly CurveRecord[]): CurveRecord =>
    all.find((other) => sameChannel(other, curve)) ?? curve;
  const canonicalCurves = (filter: (curve: CurveRecord) => boolean): CurveRecord[] => {
    const all = curves();
    return all.filter((curve) => filter(curve) && canonical(curve, all).id === curve.id);
  };

  /** Keys of a canonical curve (unioned over duplicates), split into visible winners and hidden losers. */
  const projectKeys = (curveId: CurveId): { visible: KeyRecord[]; hidden: KeyRecord[] } => {
    const curve = view.get('curves', curveId) as unknown as CurveRecord | undefined;
    if (curve === undefined) return { visible: [], hidden: [] };
    const all = curves();
    if (canonical(curve, all).id !== curve.id) return { visible: [], hidden: [] };
    const group = new Set(all.filter((other) => sameChannel(other, curve)).map((other) => other.id));
    const keys = (view.list('keys') as unknown as KeyRecord[])
      .filter((key) => group.has(key.curve))
      .sort((a, b) => a.t - b.t || compareStrings(b.id, a.id));
    const visible: KeyRecord[] = [];
    const hidden: KeyRecord[] = [];
    for (const key of keys) {
      // Sorted by t, then id descending: the first key at a time is the greatest KeyId and wins.
      const winner = visible.at(-1);
      if (winner !== undefined && winner.t === key.t) hidden.push(key);
      else visible.push(key);
    }
    return { visible, hidden };
  };

  return {
    keysOfCurve: (curve: CurveId) => projectKeys(curve).visible,
    hiddenKeys: (curve: CurveId) => projectKeys(curve).hidden,
    curvesOfClip: (clip: ClipId) => canonicalCurves((curve) => curve.clip === clip),
    curvesOfControl: (clip: ClipId, control: ControlId) =>
      canonicalCurves((curve) => curve.clip === clip && curve.control === control),
    curveFor: (clip: ClipId, layer: LayerId, control: ControlId, channel: ChannelId) =>
      curves().find(
        (curve) =>
          curve.clip === clip && curve.layer === layer && curve.control === control && curve.channel === channel,
      ),
    layersOfClip: (clip: ClipId) =>
      (view.list('layers') as unknown as LayerRecord[]).filter((layer) => layer.clip === clip).sort(byOrderThenId),
    baseLayer: (clip: ClipId) =>
      (view.list('layers') as unknown as LayerRecord[]).filter((layer) => layer.clip === clip).sort(byOrderThenId)[0],
    clipsOfCharacter: (character: CharacterId) =>
      (view.list('clips') as unknown as ClipRecord[])
        .filter((clip) => clip.character === character)
        .sort(byOrderThenId),
    rigOfCharacter: (character: CharacterId) =>
      (view.list('rigs') as unknown as RigRecord[]).find((rig) => rig.character === character),
    controlsOfRig: (rig: RigId) =>
      hierarchyOrder((view.list('controls') as unknown as ControlRecord[]).filter((c) => c.rig === rig)),
    controlByKey: (rig: RigId, templateKey: string) =>
      (view.list('controls') as unknown as ControlRecord[]).find((c) => c.rig === rig && c.key === templateKey),
    missingPartitions: (): readonly Partition[] => [],
    // M6a (M6A-SPEC §4.2), linear scans
    meshesOfOwner: (owner: CharacterId | 'scene') =>
      (view.list('meshes') as unknown as MeshRecord[]).filter((mesh) => ownerKey(mesh) === owner).sort(byOrderThenId),
    childrenOf: (parent: GroupId | MeshId | null, owner: CharacterId | 'scene') =>
      ownerChildren(view, owner).get(parent) ?? [],
    swatchesOfPalette: (palette: PaletteId) =>
      (view.list('swatches') as unknown as SwatchRecord[])
        .filter((swatch) => swatch.palette === palette)
        .sort(byOrderThenId),
    swatchBySlot: (palette: PaletteId, slot: number) =>
      (view.list('swatches') as unknown as SwatchRecord[]).find(
        (swatch) => swatch.palette === palette && swatch.slot === slot,
      ),
    imagePlanesOf: (camera: OrthoCamera) =>
      (view.list('imagePlanes') as unknown as ImagePlaneRecord[])
        .filter((plane) => plane.camera === camera)
        .sort(byOrderThenId),
    jointsOfSkeleton: (skeleton: SkeletonId) =>
      hierarchyOrder((view.list('joints') as unknown as JointRecord[]).filter((joint) => joint.skeleton === skeleton)),
  };
}

function ownerKey(record: MeshRecord | GroupRecord): string {
  return 'character' in record.owner ? record.owner.character : 'scene';
}

/** Children lists of one owner's meshes and groups; a parent that is not a live node of the owner makes a root. */
function ownerChildren(view: RowView, owner: string): ReadonlyMap<string | null, (MeshRecord | GroupRecord)[]> {
  const nodes = [
    ...(view.list('meshes') as unknown as MeshRecord[]),
    ...(view.list('groups') as unknown as GroupRecord[]),
  ].filter((node) => ownerKey(node) === owner);
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map<string | null, (MeshRecord | GroupRecord)[]>();
  for (const node of hierarchyOrder(nodes)) {
    const parent = node.parent !== null && node.parent !== node.id && ids.has(node.parent) ? node.parent : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(node);
    children.set(parent, siblings);
  }
  // Cycle members are unreachable from the roots: detach the smallest unreached id, as the doc store does.
  const reached = new Set<string>();
  const reach = (id: string | null): void => {
    for (const child of children.get(id) ?? []) {
      if (reached.has(child.id)) continue;
      reached.add(child.id);
      reach(child.id);
    }
  };
  reach(null);
  for (const node of [...nodes].sort((a, b) => compareStrings(a.id, b.id))) {
    if (reached.has(node.id)) continue;
    const parent = node.parent as string;
    children.set(
      parent,
      (children.get(parent) ?? []).filter((other) => other.id !== node.id),
    );
    children.set(null, [...(children.get(null) ?? []), node]);
    reached.add(node.id);
    reach(node.id);
  }
  for (const siblings of children.values()) siblings.sort(byOrderThenId);
  return children;
}

/** Parents before children (depth-first), siblings by `order` then id; cycle members are appended by id. */
function hierarchyOrder<T extends { readonly id: string; readonly parent: string | null; readonly order: string }>(
  controls: readonly T[],
): T[] {
  const ids = new Set(controls.map((control) => control.id));
  const children = new Map<string | null, T[]>();
  for (const control of controls) {
    const parent = control.parent !== null && ids.has(control.parent) ? control.parent : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(control);
    children.set(parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort(byOrderThenId);
  const ordered: T[] = [];
  const visited = new Set<string>();
  const visit = (control: T): void => {
    if (visited.has(control.id)) return;
    visited.add(control.id);
    ordered.push(control);
    for (const child of children.get(control.id) ?? []) visit(child);
  };
  for (const root of children.get(null) ?? []) visit(root);
  for (const control of controls) visit(control);
  return ordered;
}
