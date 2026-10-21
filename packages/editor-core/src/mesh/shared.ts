// Eager part of the mesh runtime (M6A-SPEC §2 eager/lazy split, B7): the registry's interface and constants, shared
// by the eager facade (facade.ts) and the lazy implementation (impl.ts, loaded with the kernel chunk).
import type { Disposer, ParamValues } from '@ekza-studio/anim-core';
import type { DocumentStore, MeshId, MeshRef, Tx } from '@ekza-studio/doc';
import type { ComponentKind, ComponentSelection, MeshData, MeshOp, MeshSetOp, Refusal } from '@ekza-studio/mesh-core';
import type {
  BlobId,
  BlobStore,
  EditorApp,
  MeshCommitResult,
  MeshRuntimeRegistry,
  MeshSetCommitResult,
  Notifier,
} from '../types';
import type { RunSettings } from './context';

/** §5.20: at most one sweep per 5 s. */
export const SWEEP_INTERVAL_MS = 5000;
/** §5.20: the one toast per session when the budget releases steps. */
export const BUDGET_TOAST = 'Older undo steps were released to save memory';

const HEX64 = /^[0-9a-f]{64}$/;

/** Chunk ids listed by manifest JSON bytes (no kernel needed; the same reading as `BlobStore.closure`). */
export function chunkIdsOfManifest(bytes: Uint8Array): readonly BlobId[] {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return [];
  }
  const layers = (raw as { layers?: unknown } | null)?.layers;
  if (!Array.isArray(layers)) return [];
  const out: BlobId[] = [];
  for (const layer of layers) {
    const chunks = (layer as { chunks?: unknown } | null)?.chunks;
    if (!Array.isArray(chunks)) continue;
    for (const id of chunks) if (typeof id === 'string' && HEX64.test(id)) out.push(id);
  }
  return out;
}

/** Extra commit inputs the editor's own wrappers pass (`meshOperator`, Adjust Last); the contract needs only `seed`. */
export interface CommitContext {
  readonly seed: string;
  /** Component kind the run reads its selection in; default: the current mode's (null for object-level ops). */
  readonly kind?: ComponentKind | null;
  /** Explicit selections per target (tools, tests); default: the component selection service. */
  readonly selection?: ReadonlyMap<MeshId, ComponentSelection>;
  /** Recorded symmetry/soft settings of a re-run (`LastRun.context`, §5.7); default: the session's. */
  readonly settings?: RunSettings;
  /** An adjusted re-run (§5.7): a MeshSetOp must yield the same output keys as the last run (§5.13). */
  readonly adjusting?: boolean;
}

/** Timers of the deferred work (fake ones in tests). */
export interface MeshClock {
  readonly now: () => number;
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly microtask: (fn: () => void) => void;
}

export interface GcReport {
  readonly freed: number;
  readonly bytes: number;
  /** History steps the budget dropped. */
  readonly dropped: number;
}

export interface MeshRegistryDeps {
  readonly store: DocumentStore;
  readonly blobs: BlobStore;
  /** §3 rule 8: applied to the kernel when it loads (development and e2e builds). */
  readonly kernelDebug?: boolean;
  /** Called when a runtime's state or data changes (the host requests a frame). */
  readonly changed?: () => void;
  readonly notify?: Notifier;
  readonly clock?: MeshClock;
}

/** The pre-op inputs of the last MeshSetOp (§5.5 rule 5). */
export interface LastSetOp {
  readonly opId: string;
  readonly inputs: ReadonlyMap<MeshId, MeshData>;
  readonly outputs: readonly string[];
}

export interface KernelMeshRuntimes extends MeshRuntimeRegistry {
  commitOp(tx: Tx, op: MeshOp, targets: readonly MeshId[], args: ParamValues, ctx: CommitContext): MeshCommitResult;
  commitSetOp(
    tx: Tx,
    op: MeshSetOp,
    inputs: readonly MeshId[],
    args: ParamValues,
    ctx: CommitContext,
  ): MeshSetCommitResult;
  /** Resolves when the kernel is loaded and no runtime is loading (tests, the test API). */
  settled(): Promise<void>;
  /** Binds the app (history, session, prefs, component selections); idempotent. */
  attach(app: EditorApp): void;
  readonly attached: boolean;
  /** Runs the deferred check now: reconcile, budget, journal cap and a sweep. Never inside a transaction. */
  collect(): GcReport;
  /**
   * Settles the commits of a transaction that has ended, now instead of in the next microtask: a commit whose ref the
   * store holds is confirmed, one whose transaction aborted is reverted (§5.5 rule 3). The doc store has no abort
   * hook, so the operator runner calls this after a failed run, before it reports. Never inside a transaction.
   */
  reconcile(): void;
  /** Bytes of blobs only the undo history keeps alive (§5.20 budget, first term). */
  readonly historyBytes: number;
  /** Bytes of selection snapshots in history steps and doc entries (§5.6, §5.20). */
  readonly selectionBytes: number;
  /** Pins blobs as roots (an autosave slot or a write in flight, §5.20 root 4). */
  pinBlobs(ids: readonly BlobId[]): Disposer;
  /** Stores a whole revision for a record about to be written (`mesh.create.*`): the ref (rev 1 or prior + 1). */
  storeRevision(data: MeshData, prior?: MeshRef | null, joints?: readonly string[]): MeshRef;
  /** The last MeshSetOp's pre-op inputs. */
  readonly lastSetOp: LastSetOp | null;
  /** The last op's journal edges (pinned). */
  lastOpEdges(): readonly { readonly mesh: MeshId; readonly from: string; readonly to: string }[];
  /** The selection the runtime keeps for a mesh while the component selection service cannot store one (B10). */
  localSelection(mesh: MeshId): ComponentSelection | null;
  /** Stores a selection through the component selection service, else in the runtime's fallback (until B10). */
  select(mesh: MeshId, sel: ComponentSelection): void;
  /** The selection an op on `mesh` reads in `kind` (service, local fallback, else empty). */
  selectionFor(mesh: MeshId, kind: ComponentKind): ComponentSelection | null;
  /** The kernel op's poll on every target that has edit links (closed meshes are checked by the run). */
  pollOp(op: MeshOp, targets: readonly MeshId[], kind: ComponentKind | null, settings?: RunSettings): true | Refusal;
  dispose(): void;
}
