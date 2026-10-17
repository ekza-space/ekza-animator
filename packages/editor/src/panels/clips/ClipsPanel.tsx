// Clips panel (FR-CLIP-01…04, FR-CLIP-09, research 09 §4.3 "Clips tab"): the clips of every character with the
// active-clip radio, inline rename, new / duplicate / delete and the settings popover. Every change runs a `clip.*`
// operator, so each is one undo step.
import type { CharacterId, CharacterRecord, ClipId, ClipRecord, DocumentStore } from '@ekza-animator/doc';
import { type EditorApp, PANEL, type SessionState } from '@ekza-animator/editor-core';
import { type JSX, type KeyboardEvent, type MouseEvent, useCallback, useId, useState } from 'react';
import { useDocQuery, useSession } from '../../hooks';
import type { PanelProps } from '../types';
import { DuplicateIcon, GearIcon, LoopIcon, PlusIcon, TrashIcon } from '../channel-box/kit/icons';
import { useContextMenu } from '../channel-box/kit/menu';
import { Popover } from '../channel-box/kit/popover';
import { hasMod, runOperator } from '../channel-box/kit/run';
import {
  BUTTON,
  CHECK,
  EMPTY_STATE,
  MUTED_TEXT,
  PANEL_ROOT,
  ROW_HOVER,
  ROW_SELECTED,
  TOOLBAR,
} from '../channel-box/kit/styles';
import { ClipNameInput } from './ClipNameInput';
import { ClipSettingsForm } from './ClipSettingsForm';
import { formatDuration, formatFps } from './settings';

const PANEL_KIND = PANEL.clips;

interface ClipsView {
  readonly characters: readonly { readonly record: CharacterRecord; readonly clips: readonly ClipRecord[] }[];
}

function readClips(store: DocumentStore): ClipsView {
  const characters = [...store.list('characters')]
    .sort((a, b) => (a.order === b.order ? (a.id < b.id ? -1 : 1) : a.order < b.order ? -1 : 1))
    .map((record) => ({ record, clips: store.query.clipsOfCharacter(record.id) }));
  return { characters };
}

const CLIP_TABLES = ['characters', 'clips'] as const;
const SOURCE_LABEL = { new: 'New', embedded: 'Embedded', imported: 'Imported' } as const;
const selectActiveCharacter = (s: SessionState): CharacterId | null => s.activeCharacter;
const selectActiveClip = (s: SessionState): SessionState['activeClip'] => s.activeClip;

export function ClipsPanel({ app, instanceId }: PanelProps): JSX.Element {
  const view = useDocQuery(readClips, CLIP_TABLES);
  const activeCharacter = useSession(selectActiveCharacter);
  const activeClip = useSession(selectActiveClip);
  const [renaming, setRenaming] = useState<ClipId | null>(null);
  const [settings, setSettings] = useState<{ readonly clip: ClipId; readonly anchor: HTMLElement } | null>(null);
  const menu = useContextMenu();
  const radioName = useId();

  const current: ClipId | null = activeCharacter === null ? null : (activeClip[activeCharacter] ?? null);
  const settingsClip =
    settings === null
      ? undefined
      : view.characters.flatMap((entry) => entry.clips).find((clip) => clip.id === settings.clip);

  // The clip went away (deleted, or undo of its creation): close its popover rather than float it unanchored later.
  if (settings !== null && settingsClip === undefined) setSettings(null);

  const activate = useCallback(
    (clip: ClipRecord) => {
      if (activeClip[clip.character] !== clip.id)
        void runOperator(app, PANEL_KIND, 'clip.setActive', { clip: clip.id });
    },
    [app, activeClip],
  );
  const create = async (): Promise<void> => {
    const result = await runOperator(
      app,
      PANEL_KIND,
      'clip.new',
      activeCharacter === null ? undefined : { character: activeCharacter },
    );
    if (result.status === 'finished') setRenaming(result.value.clip);
  };
  const duplicate = async (clip: ClipId): Promise<void> => {
    const result = await runOperator(app, PANEL_KIND, 'clip.duplicate', { clip });
    if (result.status === 'finished') setRenaming(result.value.clip);
  };
  const remove = (clip: ClipId): void => void runOperator(app, PANEL_KIND, 'clip.delete', { clip });
  const openSettings = (clip: ClipId, anchor: HTMLElement): void =>
    setSettings((open) => (open?.clip === clip ? null : { clip, anchor }));

  const onRowKeyDown = (clip: ClipRecord, event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'F2' || (event.key === 'Enter' && app.keymap.platform === 'mac')) setRenaming(clip.id);
    else if (event.key === 'Delete' || event.key === 'Backspace') remove(clip.id);
    else if (event.code === 'KeyD' && hasMod(app, event)) void duplicate(clip.id);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const openMenu = (clip: ClipRecord, event: MouseEvent<HTMLElement>): void => {
    const anchor = event.currentTarget.querySelector<HTMLElement>('[data-settings-anchor]') ?? event.currentTarget;
    menu.open(event, `Clip ${clip.name}`, [
      {
        kind: 'item',
        id: 'active',
        label: 'Set Active',
        disabled: activeClip[clip.character] === clip.id,
        testId: 'clips-menu-active',
        onSelect: () => activate(clip),
      },
      {
        kind: 'item',
        id: 'rename',
        label: 'Rename',
        testId: 'clips-menu-rename',
        onSelect: () => setRenaming(clip.id),
      },
      {
        kind: 'item',
        id: 'duplicate',
        label: 'Duplicate',
        testId: 'clips-menu-duplicate',
        onSelect: () => void duplicate(clip.id),
      },
      { kind: 'item', id: 'delete', label: 'Delete', testId: 'clips-menu-delete', onSelect: () => remove(clip.id) },
      { kind: 'separator', id: 'sep' },
      {
        kind: 'item',
        id: 'settings',
        label: 'Settings…',
        testId: 'clips-menu-settings',
        onSelect: () => openSettings(clip.id, anchor),
      },
    ]);
  };

  const multipleCharacters = view.characters.length > 1;
  const noCharacter = view.characters.length === 0;

  return (
    <div className={PANEL_ROOT} data-testid="clips-panel" data-instance={instanceId}>
      <div className={TOOLBAR} role="toolbar" aria-label="Clips">
        <button
          type="button"
          className={BUTTON}
          disabled={noCharacter}
          title={noCharacter ? 'Load a character first' : 'New clip for the active character'}
          data-testid="clips-new"
          onClick={() => void create()}
        >
          <PlusIcon /> New
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={current === null}
          title="Duplicate the active clip"
          aria-label="Duplicate the active clip"
          data-testid="clips-duplicate"
          onClick={() => current !== null && void duplicate(current)}
        >
          <DuplicateIcon />
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={current === null}
          title="Delete the active clip"
          aria-label="Delete the active clip"
          data-testid="clips-delete"
          onClick={() => current !== null && remove(current)}
        >
          <TrashIcon />
        </button>
      </div>
      {noCharacter ? (
        <div className={EMPTY_STATE} data-testid="clips-empty">
          No character yet. Clips belong to a character: open a model first.
        </div>
      ) : (
        // A container: the duration and Source columns show only when the dock is wide enough for them
        // (acceptance round 1: at the default width the header read "NameRange" and names were cut to "wa…").
        <div className="@container min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left" aria-label="Clips">
            <thead className="sticky top-0 z-10 bg-header text-fg-3">
              <tr className="h-[22px]">
                <th scope="col" className="w-6 font-normal">
                  <span className="sr-only">Active</span>
                </th>
                <th scope="col" className="pr-2 pl-1 font-normal">
                  Name
                </th>
                {/* Range, fps and loop shrink to their content (w-px), so the name gets the rest of the dock
                    (acceptance round 2: "Idle_Loop" read "Idle_Lo…" beside a 40 px fps column). */}
                <th scope="col" className="w-px pr-2 font-normal whitespace-nowrap">
                  Range
                </th>
                <th scope="col" className="w-px pr-1.5 text-right font-normal whitespace-nowrap">
                  fps
                </th>
                <th scope="col" className="w-5 font-normal">
                  <span className="sr-only">Loop</span>
                </th>
                <th scope="col" className="hidden pr-1 font-normal @xs:table-cell">
                  Source
                </th>
                <th scope="col" className="w-7 font-normal">
                  <span className="sr-only">Settings</span>
                </th>
              </tr>
            </thead>
            {view.characters.map(({ record, clips }) => (
              <tbody key={record.id} data-testid={`clips-character-${record.id}`}>
                {multipleCharacters ? (
                  <tr className="h-[22px] bg-header/60">
                    <th scope="rowgroup" colSpan={7} className="px-2 font-semibold text-fg-2">
                      {record.name}
                      {record.id === activeCharacter ? (
                        <span className={`ml-2 font-normal ${MUTED_TEXT}`}>active</span>
                      ) : null}
                    </th>
                  </tr>
                ) : null}
                {clips.length === 0 ? (
                  <tr>
                    <td colSpan={7} className={`px-2 py-1 ${MUTED_TEXT}`}>
                      No clips.
                    </td>
                  </tr>
                ) : null}
                {clips.map((clip) => (
                  <ClipRow
                    key={clip.id}
                    app={app}
                    clip={clip}
                    radioName={`${radioName}-${record.id}`}
                    active={activeClip[record.id] === clip.id}
                    renaming={renaming === clip.id}
                    settingsOpen={settings?.clip === clip.id}
                    onActivate={() => activate(clip)}
                    onRename={() => setRenaming(clip.id)}
                    onRenamed={() => setRenaming(null)}
                    onSettings={(anchor) => openSettings(clip.id, anchor)}
                    onMenu={(event) => openMenu(clip, event)}
                    onKeyDown={(event) => onRowKeyDown(clip, event)}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {settings !== null && settingsClip !== undefined ? (
        <Popover
          anchor={settings.anchor}
          label={`Settings of clip ${settingsClip.name}`}
          testId="clips-settings-popover"
          width={360}
          onClose={() => setSettings(null)}
        >
          <h2 className="mb-2 font-semibold">{settingsClip.name}</h2>
          <ClipSettingsForm
            key={settingsClip.id}
            app={app}
            panel={PANEL_KIND}
            clip={settingsClip}
            onApplied={() => setSettings(null)}
            onCancel={() => setSettings(null)}
          />
        </Popover>
      ) : null}
      {menu.element}
    </div>
  );
}

interface ClipRowProps {
  readonly app: EditorApp;
  readonly clip: ClipRecord;
  readonly radioName: string;
  readonly active: boolean;
  readonly renaming: boolean;
  readonly settingsOpen: boolean;
  readonly onActivate: () => void;
  readonly onRename: () => void;
  readonly onRenamed: () => void;
  readonly onSettings: (anchor: HTMLElement) => void;
  readonly onMenu: (event: MouseEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

function ClipRow(props: ClipRowProps): JSX.Element {
  const { app, clip, active } = props;
  return (
    <tr
      className={`h-[22px] cursor-default ${active ? ROW_SELECTED : ROW_HOVER}`}
      aria-current={active ? 'true' : undefined}
      data-testid={`clips-row-${clip.id}`}
      data-active={active ? 'true' : undefined}
      onClick={props.onActivate}
      onDoubleClick={props.onRename}
      onContextMenu={props.onMenu}
    >
      <td className="pl-1.5">
        <input
          type="radio"
          name={props.radioName}
          checked={active}
          aria-label={`Active clip: ${clip.name}`}
          data-testid={`clips-active-${clip.id}`}
          className={CHECK}
          onChange={props.onActivate}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={props.onKeyDown}
        />
      </td>
      <td className="max-w-0 pr-2 pl-1">
        {props.renaming ? (
          <ClipNameInput app={app} panel={PANEL_KIND} clip={clip} onDone={props.onRenamed} className="h-5" />
        ) : (
          <span className="block truncate" title={clip.name} data-testid={`clips-name-${clip.id}`}>
            {clip.name}
          </span>
        )}
      </td>
      <td
        className="pr-2 whitespace-nowrap text-fg-2 tabular-nums"
        title={`${clip.range.start}–${clip.range.end} · ${formatDuration(clip.range, clip.fps)}`}
      >
        {clip.range.start}–{clip.range.end}{' '}
        <span className={`hidden @xs:inline ${MUTED_TEXT}`}>· {formatDuration(clip.range, clip.fps)}</span>
      </td>
      <td className="pr-1.5 text-right whitespace-nowrap text-fg-2 tabular-nums">{formatFps(clip.fps)}</td>
      <td className="text-fg-2" title={clip.loop ? 'Loops' : 'Plays once'}>
        {clip.loop ? <LoopIcon /> : null}
        <span className="sr-only">{clip.loop ? 'loops' : 'once'}</span>
      </td>
      <td className={`hidden pr-1 @xs:table-cell ${MUTED_TEXT}`}>{SOURCE_LABEL[clip.source.kind]}</td>
      <td>
        <button
          type="button"
          className={BUTTON}
          aria-label={`Settings of clip ${clip.name}`}
          aria-haspopup="dialog"
          aria-expanded={props.settingsOpen}
          data-settings-anchor=""
          data-testid={`clips-settings-${clip.id}`}
          onClick={(event) => {
            event.stopPropagation();
            props.onSettings(event.currentTarget);
          }}
        >
          <GearIcon />
        </button>
      </td>
    </tr>
  );
}
