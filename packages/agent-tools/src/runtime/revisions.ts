// A minimal revision tracker (MCP-SPEC §4.4 RevisionTracker): every committed batch that touches a clip (its record,
// its curves, layers or keys) bumps that clip's revision; `check` implements the strict `ifClipRevision` test. P2
// replaces this with the automatic stale check of §5.12 (per-curve batch memory, warnings for other curves).
import type { AnyChange, ClipId, CurveId } from '@ekza-animator/doc';
import type { EditorApp } from '@ekza-animator/editor-core';
import { AgentToolFailure, type RevisionTracker } from '../types';

function clipOfChange(change: AnyChange): string | null {
  if (change.table === 'clips') return change.id;
  if (change.table !== 'keys' && change.table !== 'curves' && change.table !== 'layers') return null;
  const row = (change.after ?? change.before) as Readonly<Record<string, unknown>> | undefined;
  const clip = row?.['clip'];
  return typeof clip === 'string' ? clip : null;
}

export function createRevisionTracker(app: EditorApp): RevisionTracker {
  const revisions = new Map<string, number>();
  const seen = new Map<string, number>();
  app.store.subscribe((batch) => {
    if (batch.origin === 'preview') return;
    const touched = new Set<string>();
    for (const change of batch.changes) {
      const clip = clipOfChange(change);
      if (clip !== null) touched.add(clip);
    }
    for (const clip of touched) revisions.set(clip, (revisions.get(clip) ?? 0) + 1);
  });
  const revision = (clip: ClipId): number => revisions.get(clip) ?? 0;
  return {
    revision,
    markSeen(clip) {
      seen.set(clip, revision(clip));
    },
    check(clip, expected, _touches: { readonly curves: readonly CurveId[] | 'all'; readonly clipRecord: boolean }) {
      if (expected === undefined) return null;
      const current = revision(clip);
      if (expected === current) return null;
      throw new AgentToolFailure(
        'stale',
        `The clip changed since revision ${expected} (now ${current}).`,
        'read again (keys_read or pose_read), then redo the edit',
        { detail: { expected, current } },
      );
    },
  };
}
