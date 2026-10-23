// Clip revisions and the stale check (MCP-SPEC §4.4 RevisionTracker, §5.12). Every committed batch that touches a clip
// (its record, its layers, curves or keys) bumps that clip's revision. Results that name a clip mark the revision the
// actor has seen. A write with `ifClipRevision` fails with `stale` unless it is the current revision; without it the
// automatic check applies: the write fails with `stale` when it touches a curve (or the clip record) that another
// writer — the user, another agent, an undo — changed since this actor last saw the clip, and succeeds with a warning
// naming the changed curves when it touches others. The actor's own batches never count. The tracker remembers the
// last 1,024 batches per clip; a gap older than that answers with a warning only.
import type { AnyChange, ClipId, CurveId, DocumentStore } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { quoteName } from '../sanitize/sanitize';
import { AgentToolFailure, type RevisionTracker } from '../types';

/** Batches remembered per clip for the automatic check (§4.4). */
export const REVISION_MEMORY = 1_024;
/** Curves named in a stale message or warning. */
const NAMED_CURVES = 4;

interface ClipBatch {
  readonly revision: number;
  readonly txId: string;
  own: boolean;
  readonly curves: ReadonlySet<string>;
  readonly clipRecord: boolean;
}

interface ClipLog {
  revision: number;
  readonly batches: ClipBatch[];
  /** Revision of the oldest batch dropped from `batches` (0: nothing dropped). */
  dropped: number;
}

/** The tracker of one runtime, with the hooks the runtime uses to mark its own operator runs. */
export interface ActorRevisionTracker extends RevisionTracker {
  /** The batch of this transaction (committed by one of the actor's operator runs) is the actor's own. */
  markOwn(txId: string): void;
  /** Batches committed synchronously inside `fn` (the actor's undo navigations) are the actor's own. */
  runOwn<T>(fn: () => T): T;
  /** `fk.upperArm.L rz` for a curve id, for messages. */
  describeCurve(curve: string): string;
  dispose(): void;
}

function rowOf(change: AnyChange): Readonly<Record<string, unknown>> | undefined {
  return (change.after ?? change.before) as Readonly<Record<string, unknown>> | undefined;
}

/** The clip and the curve a change belongs to (curve null for clip records and layers). */
function locate(change: AnyChange): { readonly clip: string; readonly curve: string | null } | null {
  if (change.table === 'clips') return { clip: change.id, curve: null };
  const row = rowOf(change);
  const clip = row?.['clip'];
  if (typeof clip !== 'string') return null;
  if (change.table === 'curves') return { clip, curve: change.id };
  if (change.table === 'keys') {
    const curve = row?.['curve'];
    return { clip, curve: typeof curve === 'string' ? curve : null };
  }
  if (change.table === 'layers') return { clip, curve: null };
  return null;
}

/** `fk.upperArm.L rz` for a curve id (control key and channel), else the id. */
function curveName(store: DocumentStore, curve: string): string {
  const record = store.getIncludingDeleted('curves', curve as CurveId);
  if (record === undefined) return curve;
  const control = store.getIncludingDeleted('controls', record.control);
  return `${control?.key ?? record.control} ${record.channel}`;
}

export function createRevisionTracker(app: EditorApp): ActorRevisionTracker {
  const logs = new Map<string, ClipLog>();
  const seen = new Map<string, number>();
  let ownDepth = 0;

  const logOf = (clip: string): ClipLog => {
    let log = logs.get(clip);
    if (log === undefined) {
      log = { revision: 0, batches: [], dropped: 0 };
      logs.set(clip, log);
    }
    return log;
  };

  const unsubscribe = app.store.subscribe((batch) => {
    if (batch.origin === 'preview') return;
    if (batch.origin === 'load') {
      // A document load replaces everything (project_open, file.open): the old clips are gone.
      logs.clear();
      seen.clear();
    }
    const touched = new Map<string, { curves: Set<string>; clipRecord: boolean }>();
    for (const change of batch.changes) {
      const where = locate(change);
      if (where === null) continue;
      let entry = touched.get(where.clip);
      if (entry === undefined) {
        entry = { curves: new Set(), clipRecord: false };
        touched.set(where.clip, entry);
      }
      if (where.curve === null) entry.clipRecord = true;
      else entry.curves.add(where.curve);
    }
    const isOwn = ownDepth > 0;
    for (const [clip, entry] of touched) {
      const log = logOf(clip);
      log.revision++;
      log.batches.push({
        revision: log.revision,
        txId: batch.txId,
        own: isOwn,
        curves: entry.curves,
        clipRecord: entry.clipRecord,
      });
      if (log.batches.length > REVISION_MEMORY) {
        const removed = log.batches.splice(0, log.batches.length - REVISION_MEMORY);
        log.dropped = removed.at(-1)?.revision ?? log.dropped;
      }
    }
  });

  const revision = (clip: ClipId): number => logs.get(clip)?.revision ?? 0;
  const describe = (curve: string): string => curveName(app.store, curve);

  return {
    revision,
    markSeen(clip) {
      seen.set(clip, revision(clip));
    },
    markOwn(txId) {
      for (const log of logs.values()) {
        // the actor's batch is among the newest few of each clip it touched
        for (let i = log.batches.length - 1; i >= 0 && i >= log.batches.length - 64; i--) {
          const batch = log.batches[i] as ClipBatch;
          if (batch.txId === txId) batch.own = true;
        }
      }
    },
    runOwn(fn) {
      ownDepth++;
      try {
        return fn();
      } finally {
        ownDepth--;
      }
    },
    describeCurve: describe,
    check(clip, expected, touches) {
      const current = revision(clip);
      if (expected !== undefined) {
        if (expected === current) return null;
        throw new AgentToolFailure(
          'stale',
          `The clip changed since revision ${expected} (now ${current}).`,
          'read again (keys_read or pose_read), then redo the edit',
          { detail: { expected, current } },
        );
      }
      const since = seen.get(clip);
      // Never seen by this actor: nothing to compare with (its first read or write of the clip).
      if (since === undefined || since >= current) return null;
      const log = logs.get(clip);
      if (log === undefined) return null;
      const changedCurves = new Set<string>();
      let clipRecord = false;
      for (const batch of log.batches) {
        if (batch.revision <= since || batch.own) continue;
        for (const curve of batch.curves) changedCurves.add(curve);
        if (batch.clipRecord) clipRecord = true;
      }
      const forgotten = log.dropped > since;
      const hits: string[] = [];
      if (touches.clipRecord && clipRecord) hits.push('the clip settings');
      if (touches.curves === 'all') {
        for (const curve of changedCurves) hits.push(describe(curve));
      } else {
        for (const curve of touches.curves) if (changedCurves.has(curve)) hits.push(describe(curve));
      }
      if (hits.length > 0) {
        const named = hits.slice(0, NAMED_CURVES).map(quoteName).join(', ');
        const more = hits.length > NAMED_CURVES ? ` and ${hits.length - NAMED_CURVES} more` : '';
        throw new AgentToolFailure(
          'stale',
          `The user (or another writer) changed ${named}${more} since you read this clip.`,
          `the user changed ${named}${more} since you read this clip: read again (keys_read or pose_read), then redo the edit`,
          { detail: { current, seen: since, changed: hits.slice(0, 20) } },
        );
      }
      if (changedCurves.size === 0 && !clipRecord) {
        return forgotten ? 'the clip changed since you last read it; read it again to see the changes' : null;
      }
      const others = [...changedCurves].map(describe);
      const listedOthers = others.slice(0, NAMED_CURVES).join(', ');
      const moreOthers = others.length > NAMED_CURVES ? ` and ${others.length - NAMED_CURVES} more` : '';
      const settings = clipRecord ? (others.length > 0 ? ' and the clip settings' : 'the clip settings') : '';
      return `other curves of this clip changed since you read it (${listedOthers}${moreOthers}${settings}); your edit did not touch them`;
    },
    dispose() {
      unsubscribe();
    },
  };
}
