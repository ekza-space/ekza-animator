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
  KeyRecord,
  LayerId,
  LayerRecord,
  Partition,
  RigId,
  RigRecord,
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
  };
}

/** Parents before children (depth-first), siblings by `order` then id; cycle members are appended by id. */
function hierarchyOrder(controls: readonly ControlRecord[]): ControlRecord[] {
  const ids = new Set(controls.map((control) => control.id));
  const children = new Map<ControlId | null, ControlRecord[]>();
  for (const control of controls) {
    const parent = control.parent !== null && ids.has(control.parent) ? control.parent : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(control);
    children.set(parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort(byOrderThenId);
  const ordered: ControlRecord[] = [];
  const visited = new Set<ControlId>();
  const visit = (control: ControlRecord): void => {
    if (visited.has(control.id)) return;
    visited.add(control.id);
    ordered.push(control);
    for (const child of children.get(control.id) ?? []) visit(child);
  };
  for (const root of children.get(null) ?? []) visit(root);
  for (const control of controls) visit(control);
  return ordered;
}
