// The Clip Library's body (M6B-SPEC §0.4.7 "Panel", CR-AR-1; C12): host-agnostic (props `app`, optional `compact`),
// rendered by the Animate dock tab and the Rig Toolkit section. A search field, one card per starter-pack clip (label,
// duration, loop glyph, slot chip, Play/Stop, Use Clip), the active character's name and the credit line. Opening it
// fetches the manifest only; a clip's file is fetched on its first Play or Use Clip. A clip whose file failed its
// checksum shows a disabled card.
import type { CharacterId } from '@ekza-studio/doc';
import { type EditorApp, PANEL, type SessionState } from '@ekza-studio/editor-core';
import type { StarterPackClip } from '@ekza-studio/io';
import { Play, Repeat, Search, Square } from '@ekza-studio/ui';
import { type JSX, useEffect, useState, useSyncExternalStore } from 'react';
import { useDocQuery, useSession } from '../../hooks';
import { BUTTON, EMPTY_STATE, INPUT, MUTED_TEXT, PRIMARY_BUTTON } from '../channels/kit/styles';
import { ensurePreviewBadge } from './badge';
import {
  CHECKSUM_FAILED,
  libraryView,
  loadManifest,
  NEEDS_HUMANOID,
  runUseClip,
  subscribeLibrary,
  togglePreview,
} from './state';

export interface ClipCardListProps {
  readonly app: EditorApp;
  /** Denser layout (the Rig Toolkit section). */
  readonly compact?: boolean;
}

/** Empty-state text without a humanoid character (§0.4.7). */
export const NO_CHARACTER = 'Select a humanoid character (a VRM, or one you rigged here) to preview clips';

const selectCharacter = (s: SessionState): CharacterId | null => s.activeCharacter;
const CHARACTER_TABLES = ['characters'] as const;

function formatSeconds(seconds: number): string {
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
}

/** Re-renders when the character registry changes (a runtime finished loading). */
function useCharacterRuntimes(app: EditorApp): number {
  const [version, setVersion] = useState(0);
  useEffect(() => app.characters.subscribe(() => setVersion((v) => v + 1)), [app]);
  return version;
}

export function ClipCardList({ app, compact = false }: ClipCardListProps): JSX.Element {
  const view = useSyncExternalStore(
    (listener) => subscribeLibrary(app, listener),
    () => libraryView(app),
    () => libraryView(app),
  );
  const character = useSession(selectCharacter);
  const name = useDocQuery(
    (store) => (character === null ? null : (store.get('characters', character)?.name ?? null)),
    CHARACTER_TABLES,
  );
  useCharacterRuntimes(app);
  const [query, setQuery] = useState('');
  useEffect(() => {
    ensurePreviewBadge(app);
    loadManifest(app);
  }, [app]);

  const manifest = view.manifest;
  const preview = app.library.loaded ? app.library.service.preview : null;
  // The operators' own poll says whether this character can take clips (registered once the chunk loaded).
  const problem = (() => {
    if (character === null) return NO_CHARACTER;
    if (app.operators.get('library.preview') === undefined) return null;
    const poll = app.operators.poll('library.preview', { panel: PANEL.clipLibrary }, { character, clip: 'probe' });
    return poll === true ? null : poll.reason === NEEDS_HUMANOID ? NEEDS_HUMANOID : poll.reason;
  })();
  const needle = query.trim().toLowerCase();
  const clips = (manifest?.clips ?? []).filter(
    (clip) =>
      needle === '' ||
      clip.label.toLowerCase().includes(needle) ||
      clip.id.includes(needle) ||
      clip.source.toLowerCase().includes(needle),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 text-xs" data-testid="clip-library-body">
      <div className="flex items-center gap-1.5">
        <Search aria-hidden className="size-3.5 shrink-0 text-fg-3" />
        <input
          className={`${INPUT} flex-1`}
          type="search"
          placeholder="Search clips"
          aria-label="Search clips"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-testid="clip-library-search"
        />
      </div>
      <div className={MUTED_TEXT} data-testid="clip-library-character">
        {character === null ? 'No character selected' : `Character: ${name ?? character}`}
      </div>
      {problem !== null ? (
        <div className={EMPTY_STATE} data-testid="clip-library-empty">
          {problem}
        </div>
      ) : null}
      {view.status === 'loading' || view.status === 'idle' ? (
        <div className={MUTED_TEXT}>Loading the starter pack…</div>
      ) : null}
      {view.status === 'error' ? (
        <div className="flex items-center gap-2 text-[var(--danger,#ef6b6b)]" data-testid="clip-library-error">
          {view.error}
          <button type="button" className={BUTTON} onClick={() => loadManifest(app)}>
            Retry
          </button>
        </div>
      ) : null}
      <ul className={`flex min-h-0 flex-col overflow-auto ${compact ? 'gap-0.5' : 'gap-1'}`} aria-label="Clips">
        {clips.map((clip) => (
          <ClipCard
            key={clip.id}
            app={app}
            clip={clip}
            character={problem === null ? character : null}
            playing={preview !== null && preview.clip === clip.id && preview.character === character}
            failed={view.failed.has(clip.id)}
            busy={view.busy === clip.id}
            compact={compact}
          />
        ))}
      </ul>
      {manifest !== null ? (
        <div className={`${MUTED_TEXT} mt-auto`} data-testid="clip-library-credit">
          Library:{' '}
          <a className="underline hover:text-fg" href={manifest.sourceUrl} target="_blank" rel="noreferrer">
            Quaternius UAL
          </a>{' '}
          · CC0
        </div>
      ) : null}
    </div>
  );
}

function ClipCard(props: {
  readonly app: EditorApp;
  readonly clip: StarterPackClip;
  readonly character: CharacterId | null;
  readonly playing: boolean;
  readonly failed: boolean;
  readonly busy: boolean;
  readonly compact: boolean;
}): JSX.Element {
  const { app, clip, character, playing, failed, busy } = props;
  const disabled = failed || character === null;
  return (
    <li
      className={`flex items-center gap-1.5 rounded-[4px] border border-line px-1.5 ${props.compact ? 'py-0.5' : 'py-1'} ${
        playing ? 'bg-[var(--bg-selected,#3b3270)]' : ''
      } ${failed ? 'opacity-60' : ''}`}
      data-testid={`clip-card-${clip.id}`}
      data-playing={playing ? 'true' : 'false'}
      data-disabled={failed ? 'true' : 'false'}
    >
      <button
        type="button"
        className={BUTTON}
        disabled={disabled || busy}
        aria-pressed={playing}
        aria-label={playing ? `Stop ${clip.label}` : `Play ${clip.label}`}
        title={playing ? 'Stop (Esc)' : 'Play on the character (preview: nothing is written)'}
        onClick={() => {
          if (character !== null) void togglePreview(app, character, clip.id, PANEL.clipLibrary);
        }}
        data-testid={`clip-play-${clip.id}`}
      >
        {playing ? <Square aria-hidden className="size-3" /> : <Play aria-hidden className="size-3" />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-fg">{clip.label}</span>
        <span className={`flex items-center gap-1 ${MUTED_TEXT}`}>
          {failed ? (
            <span className="text-[var(--danger,#ef6b6b)]" data-testid={`clip-failed-${clip.id}`}>
              {CHECKSUM_FAILED}
            </span>
          ) : (
            <>
              {formatSeconds(clip.duration)}
              {clip.loop ? <Repeat aria-label="Loops" className="size-3" /> : null}
              {clip.slot !== null ? (
                <span
                  className="rounded-sm bg-[var(--bg-field,#17181b)] px-1 text-[10px]"
                  title="Ekza slot (set when free)"
                >
                  {clip.slot}
                </span>
              ) : null}
            </>
          )}
        </span>
      </div>
      <button
        type="button"
        className={PRIMARY_BUTTON}
        disabled={disabled || busy}
        title="Bring the clip into the document as an editable clip (one undo step)"
        onClick={() => {
          if (character !== null) void runUseClip(app, character, clip.id, PANEL.clipLibrary);
        }}
        data-testid={`clip-use-${clip.id}`}
      >
        Use Clip
      </button>
    </li>
  );
}
