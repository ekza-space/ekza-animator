// ④ Animations actions (AUTORIG-SPEC §5.5.2–§5.5.4; D5): every document change is an operator run — the preview
// (`library.preview` with the clip's parameters, U state), Add / Update (`autorig.clip.add`, one Use Clip step), the
// clips on the character (▶ through the shipped path: `clip.setActive`, `time.setLoop`, `time.play`; ✕ `clip.delete`;
// the slot through `clip.setSettings`), ✎ (the clip's `ar-*` tags, or a plain Use Clip's provenance, back into the
// editor) and a dropped `.vrma` (`file.importAnimation`). Plus the step's transient UI state (`animationsUi`), shared by
// the panel and the overlay instances of the view. Part of the view's lazy chunk.
import type { CharacterId, CharacterRecord, ClipId, ClipRecord } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { messages } from '../../i18n';
import { resolveSubject } from '../../progress';
import type { WizardContext } from '../../shell/context';
import { smallStore, type SmallStore } from '../../shell/store';
import type { ClipParams } from '../../types';
import { type ClipCategory, IDENTITY, isIdentity, paramsFromTags } from './data';
import { editClip, endEdit, setDraft } from './slice';

const t = (): ReturnType<typeof messages>['animations'] => messages().animations;

/** The starter-pack manifest and one of its clips (io's types, read through the library service's contract). */
export type StarterPackManifest = Awaited<ReturnType<EditorApp['library']['service']['manifest']>>;
export type StarterPackClip = StarterPackManifest['clips'][number];

/** ④'s transient UI state (per wizard session). */
export interface AnimationsUi {
  readonly manifest: StarterPackManifest | null;
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: string | null;
  /** The library clip the editor shows (the last previewed or edited card). */
  readonly selected: string | null;
  readonly query: string;
  readonly category: 'all' | ClipCategory;
  /** Library clips whose bytes failed their checksum this session (their cards are disabled). */
  readonly failed: ReadonlySet<string>;
  /** The library clip an Add / Update is running for. */
  readonly busy: string | null;
  /** The last action's message (live region): "Added Walk", a failure. */
  readonly notice: { readonly text: string; readonly tone: 'info' | 'error' } | null;
}

const uis = new WeakMap<WizardContext['session'], SmallStore<AnimationsUi>>();

export function animationsUi(ctx: Pick<WizardContext, 'session'>): SmallStore<AnimationsUi> {
  let store = uis.get(ctx.session);
  if (store === undefined) {
    store = smallStore<AnimationsUi>({
      manifest: null,
      status: 'loading',
      error: null,
      selected: null,
      query: '',
      category: 'all',
      failed: new Set(),
      busy: null,
      notice: null,
    });
    uis.set(ctx.session, store);
  }
  return store;
}

const patchUi = (ctx: Pick<WizardContext, 'session'>, patch: Partial<AnimationsUi>): void =>
  animationsUi(ctx).set((current) => ({ ...current, ...patch }));

/** Loads the manifest into the UI state (the clip-library chunk loads with it; a failure can be retried). */
export async function loadManifest(ctx: WizardContext): Promise<void> {
  patchUi(ctx, { status: 'loading', error: null });
  try {
    const manifest = await ctx.app.library.service.manifest();
    patchUi(ctx, { manifest, status: 'ready' });
  } catch (error) {
    patchUi(ctx, { status: 'error', error: error instanceof Error ? error.message : String(error) });
  }
}

/** The subject character (the session's, or the model character that adopted the subject meshes). */
export function subjectCharacter(ctx: Pick<WizardContext, 'app' | 'session'>): CharacterRecord | null {
  return resolveSubject(ctx.app.store, ctx.session.getState().subject).character;
}

/** The display name of a character (its VRM name, else its own). */
export const characterName = (character: CharacterRecord): string => character.vrm?.name || character.name;

/** The draft parameters of a library clip (identity when none). */
export const draftOf = (ctx: Pick<WizardContext, 'session'>, clip: string): ClipParams =>
  ctx.session.getState().animations.draft[clip] ?? IDENTITY;

/** The manifest entry of a library clip id. */
export const entryOf = (ui: AnimationsUi, clip: string | null): StarterPackClip | null =>
  clip === null ? null : (ui.manifest?.clips.find((entry) => entry.id === clip) ?? null);

function failedChecksum(ctx: WizardContext, clip: string, result: { status: string; error?: { code: string } }): void {
  if (result.status === 'failed' && result.error?.code === 'checksum') {
    animationsUi(ctx).set((current) => ({ ...current, failed: new Set([...current.failed, clip]) }));
  }
}

/** §5.5.2: previews a library clip with its draft parameters (`library.preview`; no document write). */
export async function previewClip(ctx: WizardContext, clip: string): Promise<void> {
  const character = subjectCharacter(ctx);
  if (character === null) return;
  patchUi(ctx, { selected: clip });
  const result = await ctx.run('library.preview', { character: character.id, clip, params: draftOf(ctx, clip) });
  failedChecksum(ctx, clip, result);
}

/** Stops the library preview (U state). */
export async function stopPreview(ctx: WizardContext): Promise<void> {
  if (ctx.app.library.loaded && ctx.app.library.service.preview !== null) await ctx.run('library.stop');
}

/** Space (§8.1): stops a playing preview, else previews the selected clip. */
export async function togglePreview(ctx: WizardContext): Promise<void> {
  if (ctx.app.library.loaded && ctx.app.library.service.preview !== null) {
    await stopPreview(ctx);
    return;
  }
  const selected = animationsUi(ctx).get().selected;
  if (selected !== null) await previewClip(ctx, selected);
}

let reviewTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * §5.5.3: new parameters for a library clip; a preview of that clip restarts with them (debounced, so a slider drag
 * derives the bytes once it rests).
 */
export function changeParams(ctx: WizardContext, clip: string, params: ClipParams): void {
  setDraft(ctx.session, clip, params);
  const playing = ctx.app.library.loaded ? ctx.app.library.service.preview : null;
  if (playing === null || playing.clip !== clip) return;
  if (reviewTimer !== null) clearTimeout(reviewTimer);
  reviewTimer = setTimeout(() => {
    reviewTimer = null;
    void previewClip(ctx, clip);
  }, 200);
}

/** §5.5.4: + Add to character / Update — `autorig.clip.add` (one Use Clip step), `replace` while editing. */
export async function addClip(ctx: WizardContext, clip: string): Promise<boolean> {
  const character = subjectCharacter(ctx);
  const ui = animationsUi(ctx).get();
  const entry = entryOf(ui, clip);
  if (character === null || entry === null || ui.busy !== null) return false;
  const editing = ctx.session.getState().animations.editing;
  const replace = editing !== null && ctx.app.store.get('clips', editing) !== undefined ? editing : null;
  patchUi(ctx, { busy: clip, notice: { text: t().adding(entry.label), tone: 'info' } });
  const result = await ctx.run('autorig.clip.add', {
    character: character.id,
    clip,
    params: draftOf(ctx, clip),
    ...(replace === null ? {} : { replace }),
  });
  failedChecksum(ctx, clip, result);
  if (result.status === 'finished') {
    if (replace !== null) endEdit(ctx.session);
    patchUi(ctx, {
      busy: null,
      notice: { text: replace === null ? t().added(entry.label) : t().updated(entry.label), tone: 'info' },
    });
    return true;
  }
  patchUi(ctx, {
    busy: null,
    notice: {
      text: result.status === 'failed' ? result.error.message : result.reason,
      tone: 'error',
    },
  });
  return false;
}

/** The library clip and parameters of a document clip: its `ar-*` tags, else a plain Use Clip's provenance. */
export function libraryClipOf(
  manifest: StarterPackManifest | null,
  record: ClipRecord,
): { readonly clip: string; readonly params: ClipParams } | null {
  const tagged = paramsFromTags(record.tags);
  if (tagged !== null) return manifest === null || manifest.clips.some((c) => c.id === tagged.clip) ? tagged : null;
  const title = record.provenance.derivedFrom[0]?.title;
  const entry = manifest?.clips.find(
    (c) => c.source === title && c.credit === record.provenance.derivedFrom[0]?.author,
  );
  return entry === undefined ? null : { clip: entry.id, params: IDENTITY };
}

/** ✎ (§5.5.4): the clip's library clip and parameters into the editor; *Update* then replaces the clip. */
export async function editDocumentClip(ctx: WizardContext, clipId: ClipId): Promise<void> {
  const record = ctx.app.store.get('clips', clipId);
  const ui = animationsUi(ctx).get();
  if (record === undefined) return;
  const source = libraryClipOf(ui.manifest, record);
  if (source === null) return;
  editClip(ctx.session, clipId, source.clip, source.params);
  patchUi(ctx, { selected: source.clip, notice: null });
  await previewClip(ctx, source.clip);
}

/** *Cancel* of a ✎ edit. */
export function cancelEdit(ctx: WizardContext): void {
  endEdit(ctx.session);
}

/** ▶ on a document clip (§5.5.2): the shipped path — active clip, loop, play in Animate. */
export async function playDocumentClip(ctx: WizardContext, clipId: ClipId): Promise<void> {
  await stopPreview(ctx);
  if ((await ctx.run('clip.setActive', { clip: clipId })).status !== 'finished') return;
  await ctx.run('time.setLoop', { loop: 'loop' });
  if (!ctx.app.session.getState().time.playing) await ctx.run('time.play');
}

/** Stops the timeline (the ▶ of a document clip pressed again). */
export async function stopDocumentClip(ctx: WizardContext): Promise<void> {
  if (ctx.app.session.getState().time.playing) await ctx.run('time.stop');
}

/** ✕ (§5.5.4): the shipped `clip.delete`. */
export async function deleteDocumentClip(ctx: WizardContext, clipId: ClipId): Promise<void> {
  const editing = ctx.session.getState().animations.editing;
  const result = await ctx.run('clip.delete', { clip: clipId });
  if (result.status === 'finished' && editing === clipId) endEdit(ctx.session);
}

/** The slot chip (§5.5.4): the shipped clip settings operator. */
export async function setClipSlot(ctx: WizardContext, clipId: ClipId, slot: string | null): Promise<void> {
  await ctx.run('clip.setSettings', { clip: clipId, slot });
}

/** Dropped `.vrma` files (§5.5.4): the shipped `file.importAnimation` onto the subject, one file after another. */
export async function importVrmaFiles(ctx: WizardContext, files: readonly File[]): Promise<void> {
  const character = subjectCharacter(ctx);
  if (character === null) {
    patchUi(ctx, { notice: { text: t().footerNoCharacter, tone: 'error' } });
    return;
  }
  for (const file of files) {
    patchUi(ctx, { notice: { text: t().importing(file.name), tone: 'info' } });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await ctx.run('file.importAnimation', { name: file.name, bytes, character: character.id });
    if (result.status !== 'finished') {
      patchUi(ctx, {
        notice: { text: result.status === 'failed' ? result.error.message : result.reason, tone: 'error' },
      });
      return;
    }
    patchUi(ctx, { notice: { text: t().added(file.name), tone: 'info' } });
  }
}

/** The clips that count as the character's animations (§4.3's rule: brought in, or new with curves; no test clips). */
export function characterClips(app: EditorApp, character: CharacterId): ClipRecord[] {
  return app.store.query
    .clipsOfCharacter(character)
    .filter(
      (clip) =>
        clip.source.kind === 'imported' ||
        clip.source.kind === 'embedded' ||
        (clip.source.kind === 'new' && app.store.query.curvesOfClip(clip.id).length > 0),
    );
}

/** The parameters a document clip records (for its row's "×1.2"), identity when none. */
export const recordedParams = (record: ClipRecord): ClipParams => paramsFromTags(record.tags)?.params ?? IDENTITY;

export { isIdentity };
