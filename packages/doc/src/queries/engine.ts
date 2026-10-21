// DocQueries over the memory store (MVP-SPEC §4.2, ARCHITECTURE §4.2 projection rules, research 06 R9).
// Relation indexes are maintained on every storage write (they include hidden and soft-deleted records); results are
// computed on demand, filtered by visibility (open partition, no tombstone), cached per group and invalidated by the
// writes that can change them. Cached arrays are frozen and shared between callers.
import type {
  CharacterId,
  ClipId,
  ControlId,
  CurveId,
  GroupId,
  LayerId,
  MeshId,
  PaletteId,
  RigId,
  SkeletonId,
} from '../ids';
import type {
  ChannelId,
  ClipRecord,
  ConstraintRecord,
  ControlRecord,
  CurveRecord,
  GroupRecord,
  ImagePlaneRecord,
  JointRecord,
  KeyRecord,
  LayerRecord,
  MeshRecord,
  OrthoCamera,
  Partition,
  RigRecord,
  SkeletonRecord,
  SwatchRecord,
} from '../records';
import type { DocQueries } from '../store';
import { compareStrings } from '../store/diff';
import { type Entry, hasTombstone, type Row } from '../store/rows';
import type { Storage } from '../store/storage';
import { byOrderThenId, hierarchyOrder } from './hierarchy';

const EMPTY: readonly never[] = Object.freeze([]);
const SEP = '\u0000';

class MultiIndex {
  private readonly map = new Map<string, Set<string>>();

  add(key: string, value: string): void {
    const set = this.map.get(key);
    if (set === undefined) this.map.set(key, new Set([value]));
    else set.add(value);
  }

  remove(key: string, value: string): void {
    const set = this.map.get(key);
    if (set === undefined) return;
    set.delete(value);
    if (set.size === 0) this.map.delete(key);
  }

  get(key: string): ReadonlySet<string> | undefined {
    return this.map.get(key);
  }

  clear(): void {
    this.map.clear();
  }
}

/** M6a: the children lists of one owner's mesh/group hierarchy, with dangling parents and cycles repaired. */
interface OwnerHierarchy {
  readonly meshes: readonly MeshRecord[];
  readonly children: ReadonlyMap<string | null, readonly (MeshRecord | GroupRecord)[]>;
}

/** M6a `MeshOwner` as a key: the character id, or 'scene'. */
function ownerOf(record: Row | undefined): string | undefined {
  if (record === undefined) return undefined;
  const owner = record['owner'];
  if (typeof owner === 'object' && owner !== null) {
    const character = (owner as Readonly<Record<string, unknown>>)['character'];
    if (typeof character === 'string') return character;
  }
  return 'scene';
}

interface KeyProjection {
  readonly canonical: CurveRecord | undefined;
  readonly visible: readonly KeyRecord[];
  readonly hidden: readonly KeyRecord[];
}

const str = (record: Row | undefined, field: string): string | undefined => {
  const value = record?.[field];
  return typeof value === 'string' ? value : undefined;
};

/** (clip, layer, control, channel): the identity of a curve's channel; duplicates share it. */
function groupOf(curve: Row): string {
  return `${String(curve['clip'])}${SEP}${String(curve['layer'])}${SEP}${String(curve['control'])}${SEP}${String(curve['channel'])}`;
}

function freeze<T>(items: T[]): readonly T[] {
  return items.length === 0 ? EMPTY : Object.freeze(items);
}

export class QueryEngine implements DocQueries {
  private readonly keysByCurve = new MultiIndex();
  private readonly curvesByGroup = new MultiIndex();
  private readonly curvesByClip = new MultiIndex();
  private readonly curvesByClipControl = new MultiIndex();
  private readonly layersByClip = new MultiIndex();
  private readonly clipsByCharacter = new MultiIndex();
  private readonly rigsByCharacter = new MultiIndex();
  private readonly controlsByRig = new MultiIndex();
  private readonly controlsByRigKey = new MultiIndex();
  // M6a
  private readonly meshesByOwner = new MultiIndex();
  private readonly groupsByOwner = new MultiIndex();
  private readonly swatchesByPalette = new MultiIndex();
  private readonly imagePlanesByCamera = new MultiIndex();
  private readonly jointsBySkeleton = new MultiIndex();
  private readonly hierarchyCache = new Map<string, OwnerHierarchy>();
  private readonly swatchCache = new Map<string, readonly SwatchRecord[]>();
  private readonly imagePlaneCache = new Map<string, readonly ImagePlaneRecord[]>();
  private readonly jointCache = new Map<string, readonly JointRecord[]>();
  // M6b schema v4 (M6B-SPEC §4.1)
  private readonly skeletonsByCharacter = new MultiIndex();
  private readonly constraintsByRig = new MultiIndex();
  private readonly meshesBySkeleton = new MultiIndex();
  private readonly constraintCache = new Map<string, readonly ConstraintRecord[]>();
  private readonly boundCache = new Map<string, readonly MeshRecord[]>();

  private readonly keyCache = new Map<string, KeyProjection>();
  /**
   * Curves whose key projection a key write made stale, dropped from `keyCache` before the next projection read
   * (M2A-SPEC §5.21.1 M-1 mechanism 3: once per curve and batch of writes, not once per key). Curve writes still
   * drop their channel's projection at once, so a deferred drop always finds the curve's current group.
   */
  private readonly staleKeyCurves = new Set<string>();
  /** The curve last added to `staleKeyCurves` (a batch writes runs of keys of one curve: one Set add per run). */
  private lastStaleCurve: string | undefined = undefined;
  private readonly clipCurvesCache = new Map<string, readonly CurveRecord[]>();
  private readonly controlCurvesCache = new Map<string, readonly CurveRecord[]>();
  private readonly layersCache = new Map<string, readonly LayerRecord[]>();
  private readonly clipsCache = new Map<string, readonly ClipRecord[]>();
  private readonly controlsCache = new Map<string, readonly ControlRecord[]>();
  private missingCache: readonly Partition[] | null = null;

  constructor(
    private readonly storage: Storage,
    private readonly isOpen: (partition: Partition) => boolean,
  ) {}

  // ---------- maintenance ----------

  /** Storage write hook: updates relation indexes and drops the caches the write can affect. */
  onWrite(table: string, id: string, prev: Entry | undefined, next: Entry | undefined): void {
    const before = prev?.record;
    const after = next?.record;
    switch (table) {
      case 'keys': {
        const from = str(before, 'curve');
        const to = str(after, 'curve');
        this.relink(this.keysByCurve, from, to, id);
        if (from !== undefined && from !== this.lastStaleCurve) this.markStale(from);
        if (to !== undefined && to !== from && to !== this.lastStaleCurve) this.markStale(to);
        break;
      }
      case 'curves':
        this.relink(this.curvesByGroup, before && groupOf(before), after && groupOf(after), id);
        this.relink(this.curvesByClip, str(before, 'clip'), str(after, 'clip'), id);
        this.relink(this.curvesByClipControl, before && clipControl(before), after && clipControl(after), id);
        if (before !== undefined) {
          this.keyCache.delete(groupOf(before));
          this.clipCurvesCache.delete(String(before['clip']));
          this.controlCurvesCache.delete(clipControl(before));
        }
        if (after !== undefined) {
          this.keyCache.delete(groupOf(after));
          this.clipCurvesCache.delete(String(after['clip']));
          this.controlCurvesCache.delete(clipControl(after));
        }
        break;
      case 'layers':
        this.relink(this.layersByClip, str(before, 'clip'), str(after, 'clip'), id);
        this.dropKeys(this.layersCache, str(before, 'clip'), str(after, 'clip'));
        break;
      case 'clips':
        this.relink(this.clipsByCharacter, str(before, 'character'), str(after, 'character'), id);
        this.dropKeys(this.clipsCache, str(before, 'character'), str(after, 'character'));
        this.missingCache = null;
        break;
      case 'characters':
        this.missingCache = null;
        break;
      case 'rigs':
        this.relink(this.rigsByCharacter, str(before, 'character'), str(after, 'character'), id);
        break;
      // M6b schema v4
      case 'skeletons':
        this.relink(this.skeletonsByCharacter, str(before, 'character'), str(after, 'character'), id);
        break;
      case 'constraints':
        this.relink(this.constraintsByRig, str(before, 'rig'), str(after, 'rig'), id);
        this.dropKeys(this.constraintCache, str(before, 'rig'), str(after, 'rig'));
        break;
      case 'controls':
        this.relink(this.controlsByRig, str(before, 'rig'), str(after, 'rig'), id);
        this.relink(this.controlsByRigKey, before && rigKey(before), after && rigKey(after), id);
        this.dropKeys(this.controlsCache, str(before, 'rig'), str(after, 'rig'));
        break;
      // M6a (M6A-SPEC §4.2)
      case 'meshes':
        this.relink(this.meshesByOwner, ownerOf(before), ownerOf(after), id);
        this.dropKeys(this.hierarchyCache, ownerOf(before), ownerOf(after));
        this.relink(this.meshesBySkeleton, skinSkeletonOf(before), skinSkeletonOf(after), id);
        this.dropKeys(this.boundCache, skinSkeletonOf(before), skinSkeletonOf(after));
        break;
      case 'groups':
        this.relink(this.groupsByOwner, ownerOf(before), ownerOf(after), id);
        this.dropKeys(this.hierarchyCache, ownerOf(before), ownerOf(after));
        break;
      case 'swatches':
        this.relink(this.swatchesByPalette, str(before, 'palette'), str(after, 'palette'), id);
        this.dropKeys(this.swatchCache, str(before, 'palette'), str(after, 'palette'));
        break;
      case 'imagePlanes':
        this.relink(this.imagePlanesByCamera, str(before, 'camera'), str(after, 'camera'), id);
        this.dropKeys(this.imagePlaneCache, str(before, 'camera'), str(after, 'camera'));
        break;
      case 'joints':
        this.relink(this.jointsBySkeleton, str(before, 'skeleton'), str(after, 'skeleton'), id);
        this.dropKeys(this.jointCache, str(before, 'skeleton'), str(after, 'skeleton'));
        break;
      default:
        break;
    }
  }

  /** Drops every cached result (partition visibility changed). Indexes stay valid. */
  invalidateAll(): void {
    this.staleKeyCurves.clear();
    this.lastStaleCurve = undefined;
    this.keyCache.clear();
    this.clipCurvesCache.clear();
    this.controlCurvesCache.clear();
    this.layersCache.clear();
    this.clipsCache.clear();
    this.controlsCache.clear();
    this.missingCache = null;
    this.hierarchyCache.clear();
    this.swatchCache.clear();
    this.imagePlaneCache.clear();
    this.jointCache.clear();
    this.constraintCache.clear();
    this.boundCache.clear();
  }

  /** Forgets everything (the storage was cleared). */
  reset(): void {
    for (const index of [
      this.keysByCurve,
      this.curvesByGroup,
      this.curvesByClip,
      this.curvesByClipControl,
      this.layersByClip,
      this.clipsByCharacter,
      this.rigsByCharacter,
      this.controlsByRig,
      this.controlsByRigKey,
      this.meshesByOwner,
      this.groupsByOwner,
      this.swatchesByPalette,
      this.imagePlanesByCamera,
      this.jointsBySkeleton,
      this.skeletonsByCharacter,
      this.constraintsByRig,
      this.meshesBySkeleton,
    ]) {
      index.clear();
    }
    this.invalidateAll();
  }

  private relink(index: MultiIndex, from: string | undefined, to: string | undefined, id: string): void {
    if (from === to) return;
    if (from !== undefined) index.remove(from, id);
    if (to !== undefined) index.add(to, id);
  }

  private dropKeys<V>(cache: Map<string, V>, a: string | undefined, b: string | undefined): void {
    if (a !== undefined) cache.delete(a);
    if (b !== undefined) cache.delete(b);
  }

  private markStale(curve: string): void {
    this.staleKeyCurves.add(curve);
    this.lastStaleCurve = curve;
  }

  /** Applies the deferred key-projection drops (see `staleKeyCurves`). */
  private dropStaleKeyGroups(): void {
    if (this.staleKeyCurves.size === 0) return;
    for (const curve of this.staleKeyCurves) {
      const record = this.storage.get('curves', curve)?.record;
      if (record !== undefined) this.keyCache.delete(groupOf(record));
    }
    this.staleKeyCurves.clear();
    this.lastStaleCurve = undefined;
  }

  // ---------- visibility ----------

  /** The record when its partition is open and it has no tombstone. */
  private live(table: string, id: string): Row | undefined {
    const entry = this.storage.get(table, id);
    if (entry === undefined || !this.isOpen(entry.partition) || hasTombstone(entry.record)) return undefined;
    return entry.record;
  }

  private liveAll(table: string, ids: ReadonlySet<string> | undefined): Row[] {
    const out: Row[] = [];
    if (ids === undefined) return out;
    for (const id of ids) {
      const record = this.live(table, id);
      if (record !== undefined) out.push(record);
    }
    return out;
  }

  // ---------- curves and keys ----------

  private projection(group: string): KeyProjection {
    this.dropStaleKeyGroups();
    const cached = this.keyCache.get(group);
    if (cached !== undefined) return cached;
    const curves = this.liveAll('curves', this.curvesByGroup.get(group)) as unknown as CurveRecord[];
    let canonical: CurveRecord | undefined;
    for (const curve of curves)
      if (canonical === undefined || compareStrings(curve.id, canonical.id) < 0) canonical = curve;
    const keys: KeyRecord[] = [];
    for (const curve of curves) {
      for (const key of this.liveAll('keys', this.keysByCurve.get(curve.id))) keys.push(key as unknown as KeyRecord);
    }
    // By time, then KeyId descending: the first key at a time is the greatest KeyId and wins.
    keys.sort((a, b) => a.t - b.t || compareStrings(b.id, a.id));
    const visible: KeyRecord[] = [];
    const hidden: KeyRecord[] = [];
    for (const key of keys) {
      const winner = visible.at(-1);
      if (winner !== undefined && winner.t === key.t) hidden.push(key);
      else visible.push(key);
    }
    const projection: KeyProjection = { canonical, visible: freeze(visible), hidden: freeze(hidden) };
    this.keyCache.set(group, projection);
    return projection;
  }

  /** The canonical (smallest-id) live curve of a channel, without projecting its keys. */
  private canonicalOf(group: string): CurveRecord | undefined {
    const cached = this.keyCache.get(group);
    if (cached !== undefined) return cached.canonical;
    let canonical: Row | undefined;
    for (const id of this.curvesByGroup.get(group) ?? EMPTY) {
      if ((canonical === undefined || compareStrings(id, canonical.id) < 0) && this.live('curves', id) !== undefined) {
        canonical = this.live('curves', id);
      }
    }
    return canonical as unknown as CurveRecord | undefined;
  }

  /** The projection of a curve's channel if `curve` is its canonical (smallest-id) live curve. */
  private canonicalProjection(curve: CurveId): KeyProjection | undefined {
    const record = this.live('curves', curve);
    if (record === undefined) return undefined;
    const projection = this.projection(groupOf(record));
    return projection.canonical?.id === curve ? projection : undefined;
  }

  keysOfCurve(curve: CurveId): readonly KeyRecord[] {
    return this.canonicalProjection(curve)?.visible ?? EMPTY;
  }

  hiddenKeys(curve: CurveId): readonly KeyRecord[] {
    return this.canonicalProjection(curve)?.hidden ?? EMPTY;
  }

  private canonicalCurves(ids: ReadonlySet<string> | undefined): readonly CurveRecord[] {
    const out: CurveRecord[] = [];
    for (const curve of this.liveAll('curves', ids) as unknown as CurveRecord[]) {
      if (this.canonicalOf(groupOf(curve as unknown as Row))?.id === curve.id) out.push(curve);
    }
    return freeze(out.sort((a, b) => compareStrings(a.id, b.id)));
  }

  curvesOfClip(clip: ClipId): readonly CurveRecord[] {
    let cached = this.clipCurvesCache.get(clip);
    if (cached === undefined) {
      cached = this.canonicalCurves(this.curvesByClip.get(clip));
      this.clipCurvesCache.set(clip, cached);
    }
    return cached;
  }

  curvesOfControl(clip: ClipId, control: ControlId): readonly CurveRecord[] {
    const key = `${clip}${SEP}${control}`;
    let cached = this.controlCurvesCache.get(key);
    if (cached === undefined) {
      cached = this.canonicalCurves(this.curvesByClipControl.get(key));
      this.controlCurvesCache.set(key, cached);
    }
    return cached;
  }

  curveFor(clip: ClipId, layer: LayerId, control: ControlId, channel: ChannelId): CurveRecord | undefined {
    return this.canonicalOf(`${clip}${SEP}${layer}${SEP}${control}${SEP}${channel}`);
  }

  // ---------- layers, clips, rigs, controls ----------

  layersOfClip(clip: ClipId): readonly LayerRecord[] {
    let cached = this.layersCache.get(clip);
    if (cached === undefined) {
      const layers = this.liveAll('layers', this.layersByClip.get(clip)) as unknown as LayerRecord[];
      cached = freeze(layers.sort(byOrderThenId));
      this.layersCache.set(clip, cached);
    }
    return cached;
  }

  baseLayer(clip: ClipId): LayerRecord | undefined {
    return this.layersOfClip(clip)[0];
  }

  clipsOfCharacter(character: CharacterId): readonly ClipRecord[] {
    let cached = this.clipsCache.get(character);
    if (cached === undefined) {
      const clips = this.liveAll('clips', this.clipsByCharacter.get(character)) as unknown as ClipRecord[];
      cached = freeze(clips.sort(byOrderThenId));
      this.clipsCache.set(character, cached);
    }
    return cached;
  }

  rigOfCharacter(character: CharacterId): RigRecord | undefined {
    const rigs = this.liveAll('rigs', this.rigsByCharacter.get(character)) as unknown as RigRecord[];
    if (rigs.length <= 1) return rigs[0];
    // Several live rigs for one character (concurrent auto-rig runs): the character's own pointer wins, else the
    // smallest RigId.
    const preferred = str(this.live('characters', character), 'rig');
    return (
      rigs.find((rig) => rig.id === preferred) ??
      rigs.reduce((min, rig) => (compareStrings(rig.id, min.id) < 0 ? rig : min))
    );
  }

  controlsOfRig(rig: RigId): readonly ControlRecord[] {
    let cached = this.controlsCache.get(rig);
    if (cached === undefined) {
      const controls = this.liveAll('controls', this.controlsByRig.get(rig)) as unknown as ControlRecord[];
      cached = freeze(hierarchyOrder(controls));
      this.controlsCache.set(rig, cached);
    }
    return cached;
  }

  controlByKey(rig: RigId, templateKey: string): ControlRecord | undefined {
    const controls = this.liveAll('controls', this.controlsByRigKey.get(`${rig}${SEP}${templateKey}`));
    if (controls.length === 0) return undefined;
    return controls.reduce((min, control) =>
      compareStrings(control.id, min.id) < 0 ? control : min,
    ) as unknown as ControlRecord;
  }

  missingPartitions(): readonly Partition[] {
    if (this.missingCache !== null) return this.missingCache;
    const missing = new Set<Partition>();
    for (const [id] of this.storage.entries('characters')) {
      if (this.live('characters', id) !== undefined && !this.isOpen(`char:${id}`)) missing.add(`char:${id}`);
    }
    for (const [id] of this.storage.entries('clips')) {
      if (this.live('clips', id) !== undefined && !this.isOpen(`clip:${id}`)) missing.add(`clip:${id}`);
    }
    this.missingCache = freeze([...missing].sort(compareStrings));
    return this.missingCache;
  }

  // ---------- M6a: meshes, groups, palettes, image planes, joints (M6A-SPEC §4.2) ----------

  /**
   * The live meshes and groups of one owner as a forest: a parent that is not a live record of the same owner (or, for
   * a group, not a group) makes its child a root, and a parent cycle is broken by detaching its member with the
   * smallest id (the load repair's rule, applied to content that arrives later, e.g. concurrent reparenting).
   */
  private hierarchy(owner: string): OwnerHierarchy {
    const cached = this.hierarchyCache.get(owner);
    if (cached !== undefined) return cached;
    const meshes = this.liveAll('meshes', this.meshesByOwner.get(owner)) as unknown as MeshRecord[];
    const groups = this.liveAll('groups', this.groupsByOwner.get(owner)) as unknown as GroupRecord[];
    const nodes = new Map<string, MeshRecord | GroupRecord>();
    const isGroup = new Set<string>();
    for (const mesh of meshes) nodes.set(mesh.id, mesh);
    for (const group of groups) {
      nodes.set(group.id, group);
      isGroup.add(group.id);
    }
    const parentOf = (node: MeshRecord | GroupRecord): string | null => {
      const parent = node.parent;
      if (parent === null || parent === node.id || !nodes.has(parent)) return null;
      if (isGroup.has(node.id) && !isGroup.has(parent)) return null;
      return parent;
    };
    const detached = new Set<string>();
    const state = new Map<string, 1 | 2>();
    for (const id of [...nodes.keys()].sort(compareStrings)) {
      if (state.has(id)) continue;
      const walk: string[] = [];
      let current: string | null = id;
      while (current !== null && !state.has(current)) {
        state.set(current, 1);
        walk.push(current);
        const node = nodes.get(current);
        current = node === undefined || detached.has(current) ? null : parentOf(node);
      }
      if (current !== null && state.get(current) === 1) {
        const cycle = walk.slice(walk.indexOf(current));
        detached.add(cycle.reduce((min, member) => (compareStrings(member, min) < 0 ? member : min)));
      }
      for (const member of walk) state.set(member, 2);
    }
    const children = new Map<string | null, (MeshRecord | GroupRecord)[]>();
    for (const node of nodes.values()) {
      const parent = detached.has(node.id) ? null : parentOf(node);
      const siblings = children.get(parent);
      if (siblings === undefined) children.set(parent, [node]);
      else siblings.push(node);
    }
    const frozen = new Map<string | null, readonly (MeshRecord | GroupRecord)[]>();
    for (const [parent, siblings] of children) frozen.set(parent, freeze(siblings.sort(byOrderThenId)));
    const result: OwnerHierarchy = { meshes: freeze(meshes.sort(byOrderThenId)), children: frozen };
    this.hierarchyCache.set(owner, result);
    return result;
  }

  meshesOfOwner(owner: CharacterId | 'scene'): readonly MeshRecord[] {
    return this.hierarchy(owner).meshes;
  }

  childrenOf(parent: GroupId | MeshId | null, owner: CharacterId | 'scene'): readonly (MeshRecord | GroupRecord)[] {
    return this.hierarchy(owner).children.get(parent) ?? EMPTY;
  }

  swatchesOfPalette(palette: PaletteId): readonly SwatchRecord[] {
    let cached = this.swatchCache.get(palette);
    if (cached === undefined) {
      const swatches = this.liveAll('swatches', this.swatchesByPalette.get(palette)) as unknown as SwatchRecord[];
      cached = freeze(swatches.sort(byOrderThenId));
      this.swatchCache.set(palette, cached);
    }
    return cached;
  }

  swatchBySlot(palette: PaletteId, slot: number): SwatchRecord | undefined {
    let found: SwatchRecord | undefined;
    for (const swatch of this.swatchesOfPalette(palette)) {
      if (swatch.slot !== slot) continue;
      if (found === undefined || compareStrings(swatch.id, found.id) < 0) found = swatch;
    }
    return found;
  }

  imagePlanesOf(camera: OrthoCamera): readonly ImagePlaneRecord[] {
    let cached = this.imagePlaneCache.get(camera);
    if (cached === undefined) {
      const planes = this.liveAll('imagePlanes', this.imagePlanesByCamera.get(camera)) as unknown as ImagePlaneRecord[];
      cached = freeze(planes.sort(byOrderThenId));
      this.imagePlaneCache.set(camera, cached);
    }
    return cached;
  }

  jointsOfSkeleton(skeleton: SkeletonId): readonly JointRecord[] {
    let cached = this.jointCache.get(skeleton);
    if (cached === undefined) {
      const joints = this.liveAll('joints', this.jointsBySkeleton.get(skeleton)) as unknown as JointRecord[];
      cached = freeze(hierarchyOrder(joints));
      this.jointCache.set(skeleton, cached);
    }
    return cached;
  }

  // ---------- M6b schema v4 (M6B-SPEC §4.1) ----------

  skeletonOfCharacter(character: CharacterId): SkeletonRecord | undefined {
    const skeletons = this.liveAll(
      'skeletons',
      this.skeletonsByCharacter.get(character),
    ) as unknown as SkeletonRecord[];
    if (skeletons.length <= 1) return skeletons[0];
    // Several live skeletons for one character (concurrent Quick Rig commits): the newest, i.e. the greatest id.
    return skeletons.reduce((max, skeleton) => (compareStrings(skeleton.id, max.id) > 0 ? skeleton : max));
  }

  constraintsOfRig(rig: RigId): readonly ConstraintRecord[] {
    let cached = this.constraintCache.get(rig);
    if (cached === undefined) {
      const constraints = this.liveAll('constraints', this.constraintsByRig.get(rig)) as unknown as ConstraintRecord[];
      cached = freeze(constraints.sort((a, b) => compareStrings(a.id, b.id)));
      this.constraintCache.set(rig, cached);
    }
    return cached;
  }

  meshesBoundTo(skeleton: SkeletonId): readonly MeshRecord[] {
    let cached = this.boundCache.get(skeleton);
    if (cached === undefined) {
      const meshes = this.liveAll('meshes', this.meshesBySkeleton.get(skeleton)) as unknown as MeshRecord[];
      cached = freeze(meshes.sort(byOrderThenId));
      this.boundCache.set(skeleton, cached);
    }
    return cached;
  }
}

/** M6b: the skeleton a mesh is bound to (`MeshRecord.skin.skeleton`), if any. */
function skinSkeletonOf(record: Row | undefined): string | undefined {
  const skin = record?.['skin'];
  if (typeof skin !== 'object' || skin === null) return undefined;
  const skeleton = (skin as Readonly<Record<string, unknown>>)['skeleton'];
  return typeof skeleton === 'string' ? skeleton : undefined;
}

function clipControl(curve: Row): string {
  return `${String(curve['clip'])}${SEP}${String(curve['control'])}`;
}

function rigKey(control: Row): string {
  return `${String(control['rig'])}${SEP}${String(control['key'])}`;
}
