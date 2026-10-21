// C12 (clip library; M6B-SPEC §0.4.7, §0.6): `library.open`, `.preview`, `.stop` (U state: no document write, no undo
// step) and `.useClip` (undoable, one step "Use Clip <label>"). Registered from the lazy clip-library chunk
// (`app.library.load()`; the runner loads it for any `library.*` id).
//
// Use Clip = `prepareVrmaImport` (the shipped VRMA import path of `file.importAnimation`, same bytes, same options) +
// `applyClipImport` + `{name: label, loop: manifest.loop, slot: manifest.slot when no clip of the character holds it}`
// in one transaction; the provenance comes from the VRMA's `ekza_animation_v1` (CC0-1.0, Quaternius, the UAL clip),
// with any field it lacks set here. The VRMA bytes are one content-addressed `animation-source` asset.
import { EkzaError } from '@ekza-studio/anim-core';
import type { CharacterId, ClipProvenance, DerivedFrom } from '@ekza-studio/doc';
import type { StarterPackClip } from '@ekza-studio/io';
import { prepareLibraryImport, previewClipOf } from '../../library/convert';
import {
  CHECKSUM_FAILED,
  type ClipLibrary,
  clipLibraryOf,
  NO_PREVIEW,
  requireClipLibrary,
} from '../../library/service';
import type { EditorApp, OperatorContext, PollResult } from '../../types';
import { GLOBAL_SCOPE } from '../../types';
import type { ClipImportPlan } from '../../workflows/importAnimation';
import { animationTargetProblem } from '../../workflows/importChecks';
import { importPathLoaded } from '../../workflows/importLoader';
import { uniqueName } from '../../workflows/names';
import { type AnyOperator, all, defineOperator, fail, isRecord, OK, runContextOf } from './define';
import { pollEditable } from './polls';

/** Poll reason for a character that is not a humanoid (§0.4.7). */
export const NEEDS_HUMANOID = 'Clips need a humanoid character';

const WORKSPACES = ['animate', 'rig'] as const;

/** Why `character` cannot take library clips, or OK (§0.4.7: humanoid characters, imported or rigged here). */
function pollTarget(app: EditorApp, args: unknown): PollResult {
  if (!isRecord(args) || typeof args['character'] !== 'string' || typeof args['clip'] !== 'string') {
    return fail('expects { character, clip }');
  }
  const problem = animationTargetProblem(app, args['character'] as CharacterId, true);
  if (problem === null) return OK;
  return fail(problem === 'VRMA clips need a humanoid (VRM) character' ? NEEDS_HUMANOID : problem);
}

/** The clip's verified bytes; a checksum failure toasts and fails the run (the card turns disabled). */
async function verifiedBytes(app: EditorApp, library: ClipLibrary, clip: string): Promise<Uint8Array> {
  try {
    return await library.bytes(clip);
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'checksum') {
      app.services.notify.toast({ kind: 'error', text: CHECKSUM_FAILED });
    }
    throw error;
  }
}

const open = defineOperator<'library.open'>({
  id: 'library.open',
  label: 'Clip Library',
  description: 'Opens the Clip Library: a dock tab in Animate, the Rig Toolkit section in Rig & Skin (M6B-SPEC §0.4.7)',
  category: 'library',
  scope: GLOBAL_SCOPE,
  workspaces: WORKSPACES,
  async prepare(ctx: OperatorContext) {
    const { app } = ctx;
    const panel = app.session.getState().workspace === 'rig' ? 'rigToolkit' : 'clipLibrary';
    // The shell registers `workspace.showPanel`; a headless app has no panels to show.
    if (app.operators.get('workspace.showPanel') !== undefined) {
      const result = await app.runUntyped('workspace.showPanel', { panel }, runContextOf(ctx));
      if (result.status === 'failed') throw new EkzaError(result.error.code, result.error.message);
    }
    // Opening the library fetches its manifest (never a clip file, §0.4.7); a failure shows in the panel.
    void requireClipLibrary(app)
      .manifest()
      .catch(() => {});
  },
  apply() {},
});

interface PreviewPlan {
  readonly clip: Awaited<ReturnType<typeof previewClipOf>>;
  /** `documentRuns` when the preparation started: a document run since then makes the preview stale. */
  readonly runs: number;
}

const preview = defineOperator<'library.preview', PreviewPlan>({
  id: 'library.preview',
  label: 'Preview Clip',
  description: 'Plays a library clip on the character in a loop without writing the document (M6B-SPEC §0.4.7)',
  category: 'library',
  scope: GLOBAL_SCOPE,
  flags: { internal: true },
  workspaces: WORKSPACES,
  poll: ({ app }, args) => pollTarget(app, args),
  async prepare({ app }, args) {
    const library = requireClipLibrary(app);
    const runs = library.documentRuns;
    const clip = await library.clip(args.clip);
    if (library.failed(clip.id)) throw new EkzaError('checksum', CHECKSUM_FAILED, { clip: clip.id });
    return { clip: await previewClipOf(app, args.character, clip, await verifiedBytes(app, library, clip.id)), runs };
  },
  apply({ app }, _args, prepared) {
    const library = requireClipLibrary(app);
    // A key, Use Clip or undo ran while the clip was being read: that edit wins, the preview does not start.
    if (library.documentRuns !== prepared.runs) return;
    library.startPreview(prepared.clip);
  },
});

const stop = defineOperator<'library.stop'>({
  id: 'library.stop',
  label: 'Stop Preview',
  description: 'Stops the clip preview (M6B-SPEC §0.4.7)',
  category: 'library',
  scope: GLOBAL_SCOPE,
  workspaces: WORKSPACES,
  poll: ({ app }) => ((clipLibraryOf(app)?.preview ?? null) === null ? fail(NO_PREVIEW) : OK),
  apply({ app }) {
    requireClipLibrary(app).stopPreview();
  },
});

interface UseClipPlan {
  readonly entry: StarterPackClip;
  readonly plan: ClipImportPlan;
}

/** The provenance Use Clip writes: the VRMA's own (CC0, Quaternius, the UAL clip), any missing field filled in. */
function libraryProvenance(read: ClipProvenance, entry: StarterPackClip, sourceSha256: string): ClipProvenance {
  const first: DerivedFrom | undefined = read.derivedFrom[0];
  const derived: DerivedFrom = {
    title: first !== undefined && first.title !== '' ? first.title : entry.source,
    author: first !== undefined && first.author !== 'unknown' && first.author !== '' ? first.author : entry.credit,
    license: first !== undefined && first.license !== 'unknown' && first.license !== '' ? first.license : entry.license,
    sourceSha256: first?.sourceSha256 ?? sourceSha256,
  };
  return { derivedFrom: [derived, ...read.derivedFrom.slice(1)], redistributable: 'yes' };
}

const useClip = defineOperator<'library.useClip', UseClipPlan>({
  id: 'library.useClip',
  label: 'Use Clip',
  description: 'Brings a library clip into the document as an editable clip on the character (M6B-SPEC §0.4.7)',
  category: 'library',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  workspaces: WORKSPACES,
  undoLabel(args) {
    return `Use Clip ${clipLibraryLabel(args.clip)}`;
  },
  poll: ({ app }, args) => all(pollEditable(app), pollTarget(app, args)),
  async prepare({ app }, args) {
    const library = requireClipLibrary(app);
    const entry = await library.clip(args.clip);
    if (library.failed(entry.id)) throw new EkzaError('checksum', CHECKSUM_FAILED, { clip: entry.id });
    labels.set(entry.id, entry.label);
    const plan = await prepareLibraryImport(app, args.character, entry, await verifiedBytes(app, library, entry.id));
    return { entry, plan };
  },
  apply({ app, tx }, args, { entry, plan }) {
    if (tx === null) throw new EkzaError('internal', 'library.useClip runs in a transaction');
    const result = importPathLoaded().applyClipImport(app, tx, plan);
    const id = result.clips[0];
    const clip = id === undefined ? undefined : tx.get('clips', id);
    if (id === undefined || clip === undefined) throw new EkzaError('internal', 'Use Clip wrote no clip');
    const others = tx.query.clipsOfCharacter(args.character).filter((other) => other.id !== id);
    const slot = entry.slot !== null && !others.some((other) => other.slot === entry.slot) ? entry.slot : null;
    tx.patch('clips', id, {
      name: uniqueName(
        entry.label,
        others.map((other) => other.name),
      ),
      loop: entry.loop,
      slot,
      provenance: libraryProvenance(clip.provenance, entry, plan.asset.id),
    });
    return { clip: id };
  },
});

/** Labels of clips Use Clip prepared (its undo label is read after `prepare`). */
const labels = new Map<string, string>();
function clipLibraryLabel(clip: string): string {
  return labels.get(clip) ?? clip;
}

export const LIBRARY_OPERATORS: readonly AnyOperator[] = [open, preview, stop, useClip];
