// C12 (clip library; M6B-SPEC §0.4.7, §0.6): `library.open`, `.preview`, `.stop` (U state: no document write, no undo
// step) and `.useClip` (undoable, one step "Use Clip <label>"). Registered from the lazy clip-library chunk
// (`app.library.load()`; the runner loads it for any `library.*` id).
//
// Use Clip = `prepareVrmaImport` (the shipped VRMA import path of `file.importAnimation`, same bytes, same options) +
// `applyClipImport` + `{name: label, loop: manifest.loop, slot: manifest.slot when no clip of the character holds it}`
// in one transaction; the provenance comes from the VRMA's `ekza_animation_v1` (CC0-1.0, Quaternius, the UAL clip),
// with any field it lacks set here. The VRMA bytes are one content-addressed `animation-source` asset.
//
// AUTORIG-SPEC §5.5.3–§5.5.4 (D5, CR-AR-2 a/c): `params` (preview and Use Clip) derive the VRMA bytes first
// (`deriveLibraryBytes`), so both read the same derived bytes; a parametrized Use Clip stores the derived bytes as its
// asset, puts the library clip first in `derivedFrom`, records the parameters as `ar-*` tags, keeps `loop` only for an
// untrimmed clip and sets `rootMotion: 'in-place'` for *In place*. `replace` deletes that clip in the same step and
// gives the new one its name, slot and place. `bytes` previews a VRMA that is no manifest entry (the range test).
// Identity parameters change nothing: C12's operators exactly.
import { EkzaError } from '@ekza-studio/anim-core';
import type { CharacterId, ClipId, ClipProvenance, DerivedFrom } from '@ekza-studio/doc';
import type { StarterPackClip } from '@ekza-studio/io';
import { type ConvertedClip, deriveLibraryBytes, prepareLibraryImport, previewClipOf } from '../../library/convert';
import { clipParamsProblem, clipParamTags, isClipParamTag } from '../../library/params';
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
import { slotProblem, uniqueName } from '../../workflows/names';
import { isTargetSlotId, loadTargetKit, targetHooks } from '../../workflows/targetSlots';
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
  // AUTORIG D5: the optional parameters (§5.5.3)
  if (args['params'] !== undefined) {
    const problem = clipParamsProblem(args['params']);
    if (problem !== null) return fail(problem);
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
  poll: ({ app }, args) => {
    const target = pollTarget(app, args);
    if (target !== true) return target;
    const raw = args as unknown as Readonly<Record<string, unknown>>;
    if (raw['bytes'] !== undefined && !(raw['bytes'] instanceof Uint8Array)) return fail('bytes must be a Uint8Array');
    if (raw['label'] !== undefined && typeof raw['label'] !== 'string') return fail('label must be a string');
    return OK;
  },
  async prepare({ app }, args) {
    const library = requireClipLibrary(app);
    const runs = library.documentRuns;
    if (args.bytes !== undefined) {
      // CR-AR-2(c): a VRMA that is no manifest entry (the range test); the badge shows its label (default: `clip`).
      const id = args.label ?? args.clip;
      const own: ConvertedClip = { id, file: `${args.clip}.vrma`, loop: true };
      const bytes = await deriveLibraryBytes(args.bytes, args.params);
      return { clip: await previewClipOf(app, args.character, own, bytes), runs };
    }
    const clip = await library.clip(args.clip);
    if (library.failed(clip.id)) throw new EkzaError('checksum', CHECKSUM_FAILED, { clip: clip.id });
    const bytes = await deriveLibraryBytes(await verifiedBytes(app, library, clip.id), args.params);
    return { clip: await previewClipOf(app, args.character, clip, bytes), runs };
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
  /** The library bytes' SHA-256 when the parameters derived other bytes (§5.5.3 step 4), else null. */
  readonly derivedFrom: string | null;
}

/** §5.5.3: a clip trimmed to less than its whole length no longer loops (the manifest's loop flag is the full clip's). */
function trimmedShort(
  args: { readonly params?: { readonly trim: { readonly start: number; readonly end: number } | null } },
  entry: StarterPackClip,
): boolean {
  const trim = args.params?.trim ?? null;
  return trim !== null && (trim.start > 1e-6 || trim.end < entry.duration - 1e-3);
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
  poll: ({ app }, args) => {
    const base = all(pollEditable(app), pollTarget(app, args));
    if (base !== true) return base;
    const raw = args as unknown as Readonly<Record<string, unknown>>;
    // CHARACTER-CONTRACT-SPEC §8.2 (C1): `slot` gives the new clip a slot (a contract slot moves off other clips).
    const slot = raw['slot'];
    if (slot !== undefined) {
      const problem = isTargetSlotId(slot)
        ? (targetHooks()?.problem(app, args.character, null, slot, { moving: true }) ?? null)
        : slotProblem(slot);
      if (problem !== null) return fail(problem);
    }
    const replace = raw['replace'];
    if (replace === undefined) return OK;
    const old = typeof replace === 'string' ? app.store.get('clips', replace as ClipId) : undefined;
    return old !== undefined && old.character === args.character ? OK : fail('replace must be a clip of the character');
  },
  async prepare({ app }, args) {
    if (isTargetSlotId(args.slot) && targetHooks() === null) await loadTargetKit(app);
    const library = requireClipLibrary(app);
    const entry = await library.clip(args.clip);
    if (library.failed(entry.id)) throw new EkzaError('checksum', CHECKSUM_FAILED, { clip: entry.id });
    labels.set(entry.id, entry.label);
    const source = await verifiedBytes(app, library, entry.id);
    const bytes = await deriveLibraryBytes(source, args.params);
    const plan = await prepareLibraryImport(app, args.character, entry, bytes);
    return { entry, plan, derivedFrom: bytes === source ? null : entry.sha256 };
  },
  apply({ app, tx, actor, access }, args, { entry, plan, derivedFrom }) {
    if (tx === null) throw new EkzaError('internal', 'library.useClip runs in a transaction');
    const replaced = args.replace === undefined ? undefined : tx.get('clips', args.replace);
    if (replaced !== undefined) tx.softDelete('clips', replaced.id);
    // M-AI (MCP-SPEC §0.4.4, MAI-B4-2): an agent's Use Clip leaves the user's active clip and playhead alone unless the
    // run may change what the user sees (`access: 'view'`).
    const quiet = actor !== undefined && actor !== null && access !== 'view';
    const result = importPathLoaded().applyClipImport(app, tx, plan, quiet ? { activate: false } : undefined);
    const id = result.clips[0];
    const clip = id === undefined ? undefined : tx.get('clips', id);
    if (id === undefined || clip === undefined) throw new EkzaError('internal', 'Use Clip wrote no clip');
    const others = tx.query.clipsOfCharacter(args.character).filter((other) => other.id !== id);
    const slot =
      args.slot !== undefined
        ? args.slot
        : replaced !== undefined
          ? replaced.slot
          : entry.slot !== null && !others.some((other) => other.slot === entry.slot)
            ? entry.slot
            : null;
    if (args.slot !== undefined && isTargetSlotId(args.slot)) {
      for (const other of others) if (other.slot === args.slot) tx.patch('clips', other.id, { slot: null });
    }
    const provenance = libraryProvenance(clip.provenance, entry, plan.asset.id);
    tx.patch('clips', id, {
      name:
        replaced !== undefined
          ? replaced.name
          : uniqueName(
              entry.label,
              others.map((other) => other.name),
            ),
      loop: entry.loop && !trimmedShort(args, entry),
      slot,
      provenance:
        derivedFrom === null
          ? provenance
          : {
              // §5.5.3 step 4: the library clip first, then the shipped provenance of the derived bytes
              derivedFrom: [
                { title: entry.source, author: entry.credit, license: entry.license, sourceSha256: derivedFrom },
                ...provenance.derivedFrom,
              ],
              redistributable: provenance.redistributable,
            },
      ...(replaced !== undefined ? { order: replaced.order } : {}),
      ...(args.params?.inPlace === true ? { rootMotion: 'in-place' as const } : {}),
      ...(derivedFrom === null || args.params === undefined
        ? {}
        : {
            tags: [...clip.tags.filter((tag) => !isClipParamTag(tag)), ...clipParamTags(entry.id, args.params)].slice(
              0,
              8,
            ),
          }),
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
