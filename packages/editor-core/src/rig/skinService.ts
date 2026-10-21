// `app.rig.skin` (M6B-SPEC §4.6, §5.9; C4): the skin-worker client. `bind(mesh, args)` builds the solver inputs from
// the document — the mesh's current revision as `SkinGeometry` (cached per revision by mesh-core) and its character's
// skeleton as `SkinSkeleton` — and runs mesh-core's pure `bindSkin` in the skin worker (`editor/src/workers/
// skin.worker.ts`) when the host installed one, else on this thread (Node tests, hosts without workers): the same
// function either way (P-S5). A later bind of the same mesh supersedes an earlier one (EkzaError('cancelled')).
//
// Part of the lazy rig-workspace chunk; mesh-core is reached through the lazy kernel loader only (§2.1).
import { EkzaError } from '@ekza-studio/anim-core';
import type {
  CharacterId,
  CharacterRecord,
  GroupId,
  JointRecord,
  MeshId,
  MeshRecord,
  ReadView,
  SkeletonId,
} from '@ekza-studio/doc';
import type {
  BindReport,
  MeshData,
  SkinBindArgs,
  SkinGeometry,
  SkinSkeleton,
  SkinWeights,
} from '@ekza-studio/mesh-core';
import { loadMeshKernel } from '../mesh/kernel';
import type { EditorApp, SkinService } from '../types';

// ---------- the worker protocol ----------

/** One bind job: everything `bindSkin` reads (typed arrays are copies, transferred to the worker). */
export interface SkinBindJob {
  readonly geometry: SkinGeometry;
  readonly skeleton: SkinSkeleton;
  readonly args: SkinBindArgs & { readonly symmetrize: boolean };
  readonly previous: SkinWeights | null;
}
export type SkinWorkerRequest = { readonly type: 'bind'; readonly id: number; readonly job: SkinBindJob };
export type SkinWorkerResponse =
  | { readonly id: number; readonly skin: SkinWeights; readonly report: BindReport }
  | { readonly id: number; readonly error: { readonly code: string; readonly message: string } };
/** The bind result the service resolves with. */
export interface SkinBindResult {
  readonly skin: SkinWeights;
  readonly report: BindReport;
}

/** The buffers of a job or a result (posted as transferables). */
export function transferablesOf(value: SkinBindJob | SkinBindResult): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const add = (array: { readonly buffer: ArrayBufferLike } | null | undefined): void => {
    if (array !== null && array !== undefined && array.buffer instanceof ArrayBuffer && !out.includes(array.buffer)) {
      out.push(array.buffer);
    }
  };
  if ('geometry' in value) {
    const { geometry: g, skeleton: s, previous } = value;
    for (const a of [g.positions, g.tris, g.normals, g.partner, s.parent, s.head, s.tail, s.mirror, s.side, s.deform])
      add(a);
    add(previous?.joints);
    add(previous?.weights);
  } else {
    add(value.skin.joints);
    add(value.skin.weights);
    add(value.report.unreachable);
  }
  return out;
}

/** A private copy of a job's typed arrays, so transferring them never detaches the caches they came from. */
export function copyJob(job: SkinBindJob): SkinBindJob {
  const { geometry: g, skeleton: s, previous } = job;
  return {
    geometry: {
      positions: g.positions.slice(),
      tris: g.tris.slice(),
      normals: g.normals.slice(),
      partner: g.partner.slice(),
      paired: g.paired,
    },
    skeleton: {
      keys: [...s.keys],
      parent: s.parent.slice(),
      head: s.head.slice(),
      tail: s.tail.slice(),
      mirror: s.mirror.slice(),
      side: s.side.slice(),
      deform: s.deform.slice(),
      humanBone: [...s.humanBone],
      height: s.height,
    },
    args: job.args,
    previous:
      previous === null
        ? null
        : {
            points: previous.points,
            palette: previous.palette,
            joints: previous.joints.slice(),
            weights: previous.weights.slice(),
          },
  };
}

// ---------- the skeleton as the solvers see it ----------

/** The humanoid-chain child of a bone (§4.2 `SkinSkeleton.tail`): the first of these that exists. */
const CHAIN: Readonly<Record<string, readonly string[]>> = {
  hips: ['spine'],
  spine: ['chest'],
  chest: ['upperChest', 'neck'],
  upperChest: ['neck'],
  neck: ['head'],
  leftEye: [],
  rightEye: [],
  leftShoulder: ['leftUpperArm'],
  rightShoulder: ['rightUpperArm'],
  leftUpperArm: ['leftLowerArm'],
  rightUpperArm: ['rightLowerArm'],
  leftLowerArm: ['leftHand'],
  rightLowerArm: ['rightHand'],
  leftHand: ['leftMiddleProximal'],
  rightHand: ['rightMiddleProximal'],
  leftUpperLeg: ['leftLowerLeg'],
  rightUpperLeg: ['rightLowerLeg'],
  leftLowerLeg: ['leftFoot'],
  rightLowerLeg: ['rightFoot'],
  leftFoot: ['leftToes'],
  rightFoot: ['rightToes'],
};
for (const side of ['left', 'right']) {
  for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
    (CHAIN as Record<string, readonly string[]>)[`${side}${finger}Proximal`] = [`${side}${finger}Intermediate`];
    (CHAIN as Record<string, readonly string[]>)[`${side}${finger}Intermediate`] = [`${side}${finger}Distal`];
  }
  (CHAIN as Record<string, readonly string[]>)[`${side}ThumbMetacarpal`] = [`${side}ThumbProximal`];
  (CHAIN as Record<string, readonly string[]>)[`${side}ThumbProximal`] = [`${side}ThumbDistal`];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The L/R name swap (§5.13): `left*`/`right*` words and `.L`/`_L` suffixes, or null. */
function swapSideName(name: string): string | null {
  const suffix = /([._\- ])([LlRr])$/.exec(name);
  if (suffix !== null) {
    const s = suffix[2] as string;
    const to = s === 'L' ? 'R' : s === 'R' ? 'L' : s === 'l' ? 'r' : 'l';
    return `${name.slice(0, -1)}${to}`;
  }
  for (const [from, to] of [
    ['left', 'right'],
    ['right', 'left'],
    ['Left', 'Right'],
    ['Right', 'Left'],
  ] as const) {
    const at = name.indexOf(from);
    if (at !== -1) return `${name.slice(0, at)}${to}${name.slice(at + from.length)}`;
  }
  return null;
}

/**
 * The skeleton as the solvers see it (§4.2 `SkinSkeleton`): the live joints of `skeleton`, topological (parents
 * first, then `JointRecord.order`, then id); keys = JointIds; tails by the humanoid chain, the first child, the
 * record's tail, else 0.05 H along the parent direction; mirrors by `JointRecord.mirror`, the human bone's
 * counterpart, then the L/R name swap; `deform` = role 'bone'; H = the joints' height (heads and tails).
 */
export function skinSkeletonOf(view: ReadView, skeleton: SkeletonId): SkinSkeleton {
  const live = view.list('joints').filter((joint) => joint.skeleton === skeleton && joint.deleted === null);
  const byId = new Map(live.map((joint) => [joint.id as string, joint]));
  const children = new Map<string | null, JointRecord[]>();
  for (const joint of live) {
    const parent = joint.parent !== null && byId.has(joint.parent) && joint.parent !== joint.id ? joint.parent : null;
    const list = children.get(parent);
    if (list === undefined) children.set(parent, [joint]);
    else list.push(joint);
  }
  for (const list of children.values()) list.sort((a, b) => compare(a.order, b.order) || compare(a.id, b.id));
  const ordered: JointRecord[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null): void => {
    for (const joint of children.get(parent) ?? []) {
      if (seen.has(joint.id)) continue;
      seen.add(joint.id);
      ordered.push(joint);
      visit(joint.id);
    }
  };
  visit(null);
  for (const joint of [...live].sort((a, b) => compare(a.id, b.id))) {
    if (seen.has(joint.id)) continue;
    seen.add(joint.id);
    ordered.push(joint);
    visit(joint.id);
  }
  const J = ordered.length;
  const index = new Map(ordered.map((joint, i) => [joint.id as string, i]));
  const byBone = new Map<string, number>();
  const byName = new Map<string, number>();
  ordered.forEach((joint, i) => {
    if (joint.humanBone !== null && !byBone.has(joint.humanBone)) byBone.set(joint.humanBone, i);
    if (!byName.has(joint.name)) byName.set(joint.name, i);
  });
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const joint of ordered) {
    for (const p of joint.tail === null ? [joint.restPosition] : [joint.restPosition, joint.tail]) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  const height = maxY - minY > 1e-6 ? maxY - minY : 1;
  const parent = new Int32Array(J);
  const head = new Float64Array(3 * J);
  const tail = new Float64Array(3 * J);
  const mirror = new Int32Array(J);
  const side = new Uint8Array(J);
  const deform = new Uint8Array(J);
  const kids: number[][] = Array.from({ length: J }, () => []);
  ordered.forEach((joint, i) => {
    const p = joint.parent === null ? undefined : index.get(joint.parent);
    parent[i] = p === undefined || p === i ? -1 : p;
    if (parent[i] >= 0) (kids[parent[i]] as number[]).push(i);
    head.set(joint.restPosition, 3 * i);
    side[i] = joint.side === 'L' ? 1 : joint.side === 'R' ? 2 : 0;
    deform[i] = joint.role === 'bone' ? 1 : 0;
  });
  ordered.forEach((joint, i) => {
    let m = joint.mirror === null ? undefined : index.get(joint.mirror);
    if (m === undefined && joint.humanBone !== null) {
      const bone = swapSideName(joint.humanBone);
      if (bone !== null) m = byBone.get(bone);
    }
    if (m === undefined) {
      const name = swapSideName(joint.name);
      if (name !== null) m = byName.get(name);
    }
    mirror[i] = m === undefined || m === i ? -1 : m;
    const chain = joint.humanBone === null ? undefined : (CHAIN[joint.humanBone] ?? []).map((bone) => byBone.get(bone));
    const chainChild = chain?.find((c) => c !== undefined && parent[c] === i);
    const first = (kids[i] as number[])[0];
    let end: readonly number[];
    if (chainChild !== undefined) end = ordered[chainChild]?.restPosition as readonly number[];
    else if (first !== undefined) end = ordered[first]?.restPosition as readonly number[];
    else if (joint.tail !== null) end = joint.tail;
    else {
      const p = parent[i] as number;
      const from =
        p >= 0
          ? (ordered[p] as JointRecord).restPosition
          : [joint.restPosition[0], joint.restPosition[1] - 1, joint.restPosition[2]];
      const d = [joint.restPosition[0] - from[0], joint.restPosition[1] - from[1], joint.restPosition[2] - from[2]];
      const len = Math.hypot(d[0] as number, d[1] as number, d[2] as number);
      const dir = len > 0 ? d.map((x) => x / len) : [0, 1, 0];
      end = joint.restPosition.map((x, k) => x + 0.05 * height * (dir[k] as number));
    }
    tail.set(end, 3 * i);
  });
  return {
    keys: ordered.map((joint) => joint.id),
    parent,
    head,
    tail,
    mirror,
    side,
    deform,
    humanBone: ordered.map((joint) => joint.humanBone),
    height,
  };
}

/** §4.2 `symmetrize: null` (auto): true when the mesh is paired (≥ 0.9) and the skeleton has mirror pairs. */
export function autoSymmetrize(geometry: SkinGeometry, skeleton: SkinSkeleton): boolean {
  return geometry.paired >= 0.9 && skeleton.mirror.some((m) => m >= 0);
}

// ---------- targets ----------

const IDENTITY_EPS = 1e-9;

function isIdentity(x: MeshRecord['placement']): boolean {
  return (
    x.t.every((v) => Math.abs(v) <= IDENTITY_EPS) &&
    Math.abs(x.q[0]) <= IDENTITY_EPS &&
    Math.abs(x.q[1]) <= IDENTITY_EPS &&
    Math.abs(x.q[2]) <= IDENTITY_EPS &&
    x.s.every((v) => Math.abs(v - 1) <= IDENTITY_EPS)
  );
}

/** The character a mesh belongs to (owner `char:<id>`), or null for a scene mesh. */
export function characterOfMesh(record: MeshRecord): CharacterId | null {
  return 'character' in record.owner ? record.owner.character : null;
}

/** The skeleton of a model-sourced character (`source.skeleton`, else the newest live skeleton record). */
export function skeletonOfModelCharacter(view: ReadView, character: CharacterRecord): SkeletonId | null {
  if (character.source.kind === 'model') {
    const record = view.get('skeletons', character.source.skeleton);
    if (record !== undefined && record.deleted === null) return record.id;
  }
  return view.query.skeletonOfCharacter(character.id)?.id ?? null;
}

/** Why a mesh cannot be bound (§5.9 refusals), or null. */
export function bindRefusal(view: ReadView, mesh: MeshId): string | null {
  const record = view.get('meshes', mesh);
  if (record === undefined || record.deleted !== null) return `Mesh ${mesh} does not exist`;
  const character = characterOfMesh(record);
  if (character === null) return `${record.name} belongs to no character: create a skeleton for it first`;
  const char = view.get('characters', character);
  if (char === undefined || char.deleted !== null) return `${record.name} belongs to no character`;
  if (char.source.kind === 'asset') return 'Rig and skin edits on imported avatars arrive after the MVP';
  if (skeletonOfModelCharacter(view, char) === null) return `${char.name} has no skeleton: create one first`;
  if (record.data === null) return `${record.name} has no editable mesh data`;
  // The mesh and every ancestor (groups, parent meshes) sit at the character's origin (§5.1).
  let at: { readonly placement: MeshRecord['placement']; readonly parent: string | null } | undefined = record;
  for (let guard = 0; at !== undefined && guard < 256; guard++) {
    if (!isIdentity(at.placement)) {
      return `${record.name} has a placement (Freeze Transformations first: skinned meshes sit at the character's origin)`;
    }
    const parent: string | null = at.parent;
    at = parent === null ? undefined : (view.get('groups', parent as GroupId) ?? view.get('meshes', parent as MeshId));
  }
  return null;
}

/** Waits until a mesh's revision is resident and returns its stored form. */
export async function readyMeshData(app: EditorApp, mesh: MeshId): Promise<MeshData> {
  await loadMeshKernel();
  const runtime = app.meshes.get(mesh);
  if (runtime !== undefined && runtime.state === 'loading') {
    await new Promise<void>((resolve) => {
      const off = runtime.subscribe((event) => {
        if (event.type === 'state' && event.state !== 'loading') {
          off();
          resolve();
        }
      });
      if (runtime.state !== 'loading') {
        off();
        resolve();
      }
    });
  }
  const data = runtime?.data() ?? null;
  if (data === null)
    throw new EkzaError('mesh-not-ready', `${mesh}: ${runtime?.error ?? 'its mesh data is not available'}`);
  return data;
}

/** Everything a bind of one mesh reads, from the current document. */
export interface SkinBindInputs {
  readonly mesh: MeshId;
  readonly character: CharacterId;
  readonly skeletonId: SkeletonId;
  readonly data: MeshData;
  readonly geometry: SkinGeometry;
  readonly skeleton: SkinSkeleton;
  /** The mesh's current skin (the masked run's `previous`). */
  readonly previous: SkinWeights | null;
}

export async function skinBindInputs(app: EditorApp, mesh: MeshId): Promise<SkinBindInputs> {
  const refusal = bindRefusal(app.store, mesh);
  if (refusal !== null) throw new EkzaError('op-refused', refusal);
  const record = app.store.get('meshes', mesh) as MeshRecord;
  const character = characterOfMesh(record) as CharacterId;
  const skeletonId = skeletonOfModelCharacter(
    app.store,
    app.store.get('characters', character) as CharacterRecord,
  ) as SkeletonId;
  const data = await readyMeshData(app, mesh);
  const kernel = await loadMeshKernel();
  const skeleton = skinSkeletonOf(app.store, skeletonId);
  return {
    mesh,
    character,
    skeletonId,
    data,
    geometry: kernel.skinGeometryOf(data, skeleton.height),
    skeleton,
    previous: kernel.readSkin(data),
  };
}

// ---------- the service ----------

/** The part of a DOM `Worker` the client uses (editor-core has no DOM types). */
export interface SkinWorkerPort {
  postMessage(message: SkinWorkerRequest, transfer: ArrayBuffer[]): void;
  onmessage: ((event: { readonly data: SkinWorkerResponse }) => void) | null;
  onerror: ((event: { readonly message?: string; preventDefault?(): void }) => void) | null;
  terminate(): void;
}

/** Set by the host on `app.rig` (`editor/src/services/skinWorker.ts`): creates the skin worker on first use. */
export interface SkinWorkerHost {
  skinWorker?: (() => SkinWorkerPort) | null;
}

export interface SkinServiceImpl extends SkinService {
  /** Runs a prepared job (tests; `bind` builds its job from the document). */
  run(mesh: MeshId, job: SkinBindJob): Promise<SkinBindResult>;
  /** Busy changes (the progress pill). */
  subscribe(listener: () => void): () => void;
  /** Rejects every pending bind with EkzaError('cancelled') and stops the worker's current job. */
  cancel(): void;
  /** The skeleton of a skeleton record as the solvers see it (C6's weight edits, the test API, validation). */
  skeleton(id: SkeletonId): SkinSkeleton;
  /** The report of the mesh's last finished bind in this session (`skin.unreachable-island`), or null. */
  report(mesh: MeshId): BindReport | null;
  /** Number of binds in flight. */
  readonly pending: number;
  /** True when the last bind ran in the worker (P-S5 checks; false for the inline path). */
  readonly usedWorker: boolean;
}

interface Pending {
  readonly mesh: MeshId;
  readonly resolve: (result: SkinBindResult) => void;
  readonly reject: (error: unknown) => void;
}

const cancelled = (mesh: MeshId): EkzaError => new EkzaError('cancelled', `Bind Skin of ${mesh} was superseded`);

export function createSkinService(deps: { readonly app: () => EditorApp }): SkinServiceImpl {
  let worker: SkinWorkerPort | null = null;
  let nextId = 1;
  let usedWorker = false;
  const pending = new Map<number, Pending>();
  const reports = new Map<MeshId, BindReport>();
  const latest = new Map<MeshId, number>();
  const listeners = new Set<() => void>();
  let busy = false;
  const setBusy = (): void => {
    const next = pending.size > 0;
    if (next === busy) return;
    busy = next;
    for (const listener of listeners) listener();
  };

  const factory = (): (() => SkinWorkerPort) | null => (deps.app().rig as unknown as SkinWorkerHost).skinWorker ?? null;

  const onMessage = (event: { readonly data: SkinWorkerResponse }): void => {
    const response = event.data;
    const job = pending.get(response.id);
    if (job === undefined) return;
    pending.delete(response.id);
    setBusy();
    if ('error' in response) job.reject(new EkzaError(response.error.code, response.error.message));
    else {
      reports.set(job.mesh, response.report);
      job.resolve({ skin: response.skin, report: response.report });
    }
  };

  const stopWorker = (): void => {
    worker?.terminate();
    worker = null;
  };

  const runInline = async (id: number, job: SkinBindJob): Promise<void> => {
    const kernel = await loadMeshKernel();
    const entry = pending.get(id);
    if (entry === undefined) return; // superseded while the kernel loaded
    try {
      const result = kernel.bindSkin(job.geometry, job.skeleton, job.args, job.previous);
      pending.delete(id);
      setBusy();
      reports.set(entry.mesh, result.report);
      entry.resolve(result);
    } catch (error) {
      pending.delete(id);
      setBusy();
      entry.reject(error);
    }
  };

  const service: SkinServiceImpl = {
    async bind(mesh: MeshId, args: SkinBindArgs): Promise<SkinBindResult> {
      const inputs = await skinBindInputs(deps.app(), mesh);
      const symmetrize = args.symmetrize ?? autoSymmetrize(inputs.geometry, inputs.skeleton);
      const job: SkinBindJob = {
        geometry: inputs.geometry,
        skeleton: inputs.skeleton,
        args: { ...args, symmetrize },
        previous: args.points === null ? null : inputs.previous,
      };
      return service.run(mesh, job);
    },
    run(mesh: MeshId, job: SkinBindJob): Promise<SkinBindResult> {
      // A later run of the same mesh supersedes an earlier one.
      const earlier = latest.get(mesh);
      if (earlier !== undefined) {
        const entry = pending.get(earlier);
        if (entry !== undefined) {
          pending.delete(earlier);
          entry.reject(cancelled(mesh));
          // The worker is busy with the superseded job: restart it rather than wait.
          if (worker !== null && pending.size === 0) stopWorker();
        }
      }
      const id = nextId++;
      latest.set(mesh, id);
      const promise = new Promise<SkinBindResult>((resolve, reject) => {
        pending.set(id, { mesh, resolve, reject });
      });
      setBusy();
      const create = factory();
      if (create === null) {
        usedWorker = false;
        void runInline(id, job);
        return promise;
      }
      try {
        if (worker === null) {
          worker = create();
          worker.onmessage = onMessage;
          worker.onerror = (event) => {
            event.preventDefault?.();
            const failed = [...pending.values()];
            pending.clear();
            stopWorker();
            setBusy();
            for (const entry of failed)
              entry.reject(new EkzaError('internal', `skin worker: ${event.message ?? 'failed'}`));
          };
        }
        const copy = copyJob(job);
        const request: SkinWorkerRequest = { type: 'bind', id, job: copy };
        worker.postMessage(request, transferablesOf(copy));
        usedWorker = true;
      } catch {
        // No worker (blocked, unsupported): the same function on this thread.
        stopWorker();
        usedWorker = false;
        void runInline(id, job);
      }
      return promise;
    },
    get busy(): boolean {
      return busy;
    },
    get pending(): number {
      return pending.size;
    },
    get usedWorker(): boolean {
      return usedWorker;
    },
    clipboard: null,
    skeleton: (id: SkeletonId): SkinSkeleton => skinSkeletonOf(deps.app().store, id),
    report: (mesh: MeshId): BindReport | null => reports.get(mesh) ?? null,
    cancel(): void {
      const all = [...pending.values()];
      pending.clear();
      latest.clear();
      stopWorker();
      setBusy();
      for (const entry of all) entry.reject(cancelled(entry.mesh));
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return service;
}
