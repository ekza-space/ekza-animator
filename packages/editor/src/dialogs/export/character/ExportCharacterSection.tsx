// The Export dialog's Character section (M6B-SPEC §8.13, §0.4.6, §5.22; C10): a model-sourced character as one VRM
// 1.0 avatar for Ekza Space and OMOBA (`ekza/space-avatar-v1`, the default) or, through `local/generic`, a VRM or a
// plain GLB. The banner says what OMOBA does with it; the profile's Validation rows and the VRM meta rows gate the
// Export button; the clips are the slot clips (test clips never listed); the VRM meta and the thumbnail are edited
// in place; after the export the lints, the read-back and the validator results, and the file size, are listed.
// CHARACTER-CONTRACT-SPEC §8.10 (C2): the profile *OMOBA character (VRM 1.0 with your animations)* exports the hero
// package of a character bound to an OMOBA target — the target's slot clips (`clips: 'target'`), the slot map, the
// contract's rules as errors — and offers the developer zip (`target.exportPackage`).
import type { CharacterId, ClipId, DocumentStore } from '@ekza-studio/doc';
import { characterRequestProblem, type EditorApp, preloadExportPath } from '@ekza-studio/editor-core';
import {
  CHARACTER_EXPORT_BANNER,
  type CharacterFormat,
  type CharacterReadBack,
  characterFormats,
  characterProfiles,
  type ExportArtifact,
  OMOBA_PACKAGE_PROFILE_ID,
  SPACE_PROFILE_ID,
} from '@ekza-studio/io';
import {
  Badge,
  Button,
  Checkbox,
  CircleCheck,
  DialogFooter,
  NativeSelect,
  TextInput,
  TriangleAlert,
} from '@ekza-studio/ui';
import { type JSX, useEffect, useId, useState } from 'react';
import { useDocQuery, useSession } from '../../../hooks';
import { useRegistryList } from '../../../hooks/useRegistry';
import { useShell } from '../../../shell/context';
import { asArtifacts } from '../../../shell/exports';
import { CharacterChecks, useCharacterRows } from './CharacterChecks';
import { ThumbnailPreview } from './ThumbnailPreview';
import { VrmMetaFields } from './VrmMetaFields';

export { CharacterChecks, useCharacterRows } from './CharacterChecks';
export { ThumbnailPreview } from './ThumbnailPreview';
export { VrmMetaFields } from './VrmMetaFields';

const MATERIAL_OPTIONS = [
  { value: '', label: "Each mesh's own" },
  { value: 'unlit', label: 'Unlit' },
  { value: 'lit', label: 'Lit (swatch shaders)' },
] as const;
const FORMAT_LABEL: Readonly<Record<CharacterFormat, string>> = { vrm: 'VRM 1.0', glb: 'Plain GLB (no VRM)' };

/** The live model-sourced characters (id, name). */
export function modelCharacters(store: DocumentStore): { readonly id: CharacterId; readonly name: string }[] {
  return store
    .list('characters')
    .filter((c) => c.deleted === null && c.source?.kind === 'model')
    .map((c) => ({ id: c.id, name: c.name }));
}

/** The exportable clips of a character: never test clips; slot clips first checked. */
function clipRows(store: DocumentStore, character: CharacterId | null) {
  if (character === null) return [];
  return store.query
    .clipsOfCharacter(character)
    .filter((clip) => clip.deleted === null && clip.source.kind !== 'test')
    .map((clip) => ({
      id: clip.id,
      name: clip.name,
      slot: clip.slot !== null && clip.slot.trim() !== '' ? clip.slot : null,
    }));
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1_048_576).toFixed(2)} MiB`;
}

function ArtifactResult(props: { readonly artifact: ExportArtifact }): JSX.Element {
  const { artifact } = props;
  const readBack = artifact.readBack as Partial<CharacterReadBack> | null;
  return (
    <div className="rounded-button border border-line bg-field p-2" data-testid="export-char-result">
      <div className="flex flex-wrap items-center gap-2 text-ui">
        <CircleCheck size={14} className="text-ok" />
        <span className="font-semibold text-fg">{artifact.fileName}</span>
        <span className="text-fg-3" data-testid="export-char-size">
          {formatBytes(artifact.bytes.byteLength)}
        </span>
        {readBack === null ? null : (
          <Badge tone={readBack.ok === true ? 'ok' : 'danger'}>
            {readBack.ok === true ? 'Read-back OK' : 'Read-back failed'}
          </Badge>
        )}
        {artifact.validation === null ? null : (
          <Badge tone={artifact.validation.errors === 0 ? 'ok' : 'danger'}>
            glTF-Validator: {artifact.validation.errors} errors
          </Badge>
        )}
      </div>
      {artifact.lints.length === 0 ? (
        <p className="mt-1 text-ui text-fg-3">No lint issues.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-0.5">
          {artifact.lints.map((lint) => (
            <li key={`${lint.code}:${lint.pointer ?? ''}:${lint.message}`} className="flex gap-2 text-ui">
              <Badge tone={lint.severity === 'error' ? 'danger' : lint.severity === 'warning' ? 'warn' : 'info'}>
                {lint.severity}
              </Badge>
              <span className="font-mono text-ui-dense text-fg-3">{lint.code}</span>
              <span className="text-fg-2">{lint.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ExportCharacterSection(props: {
  readonly app?: EditorApp;
  readonly onCancel: () => void;
}): JSX.Element {
  const shell = useShell();
  const app = props.app ?? shell.app;
  const ids = useId();
  const characters = useDocQuery(modelCharacters, ['characters']);
  const active = useSession((s) => s.rig.character ?? s.activeCharacter);
  const [characterChoice, setCharacterChoice] = useState<CharacterId | null>(null);
  const character = characterChoice ?? characters.find((c) => c.id === active)?.id ?? characters[0]?.id ?? null;
  const profiles = characterProfiles(useRegistryList(app.exportProfiles));
  const [profileChoice, setProfile] = useState<string>(SPACE_PROFILE_ID);
  const profile = profiles.some((p) => p.id === profileChoice) ? profileChoice : (profiles[0]?.id ?? null);
  const formats = characterFormats(profile);
  const [formatChoice, setFormat] = useState<CharacterFormat>('vrm');
  const format = formats.includes(formatChoice) ? formatChoice : (formats[0] ?? 'vrm');
  const clips = useDocQuery((store) => clipRows(store, character), ['clips', 'characters']);
  const [chosenClips, setChosenClips] = useState<ReadonlySet<ClipId> | null>(null);
  const slotClips = clips.filter((clip) => clip.slot !== null);
  const chosen = chosenClips ?? new Set(slotClips.map((clip) => clip.id));
  const [material, setMaterial] = useState<'' | 'unlit' | 'lit'>('');
  const [fileName, setFileName] = useState<string | null>(null);
  const name = characters.find((c) => c.id === character)?.name ?? 'character';
  const [running, setRunning] = useState(false);
  const [artifact, setArtifact] = useState<ExportArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = useCharacterRows(app, character, profile, format);
  const pkg = profile === OMOBA_PACKAGE_PROFILE_ID;

  useEffect(() => {
    void preloadExportPath().catch(() => {});
  }, []);

  const request = {
    ...(character === null ? {} : { character }),
    fileName: fileName ?? name,
    format,
    profile,
    clips: pkg ? ('target' as const) : chosenClips === null ? ('slots' as const) : [...chosen],
    includeProps: null,
    material: material === '' ? null : material,
    thumbnail: format === 'vrm' ? ('stored' as const) : ('none' as const),
    validate: true,
  };
  const problem =
    character === null
      ? 'Make a character from your model first (Rig & Skin › Quick Rig)'
      : characterRequestProblem(app, request);
  const errors = rows.filter((row) => row.severity === 'error');
  const blocked =
    problem ?? (errors.length > 0 ? `${errors.length} error${errors.length === 1 ? '' : 's'} block the export` : null);

  const run = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      const result = await shell.runFromUi('file.exportCharacter', request);
      if (result.status === 'finished') setArtifact(asArtifacts(result.value)?.[0] ?? null);
      else setError(result.status === 'failed' ? result.error.message : result.reason);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="export-character">
      <p
        className="flex items-start gap-1.5 rounded-button border border-line bg-field p-2 text-ui text-fg-2"
        data-testid="export-char-banner"
      >
        <TriangleAlert size={14} className="mt-0.5 shrink-0 text-accent" />
        {pkg
          ? 'The package carries your slot animations and the slot map for OMOBA; empty slots use OMOBA’s own animations.'
          : CHARACTER_EXPORT_BANNER}
      </p>
      {characters.length === 0 ? (
        <p className="text-ui text-fg-3">No character made from a model yet: Rig & Skin › Quick Rig makes one.</p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        {characters.length > 1 ? (
          <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={`${ids}-character`}>
            Character
            <NativeSelect
              id={`${ids}-character`}
              value={character ?? ''}
              data-testid="export-char-character"
              onChange={(event) => {
                setCharacterChoice(event.currentTarget.value as CharacterId);
                setChosenClips(null);
                setArtifact(null);
              }}
              options={characters.map((c) => ({ value: c.id, label: c.name }))}
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={`${ids}-profile`}>
          Profile
          <NativeSelect
            id={`${ids}-profile`}
            value={profile ?? ''}
            data-testid="export-char-profile"
            onChange={(event) => {
              setProfile(event.currentTarget.value);
              setArtifact(null);
            }}
            options={profiles.map((p) => ({ value: p.id, label: p.label }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={`${ids}-format`}>
          Format
          <NativeSelect
            id={`${ids}-format`}
            value={format}
            data-testid="export-char-format"
            disabled={formats.length < 2}
            onChange={(event) => {
              setFormat(event.currentTarget.value as CharacterFormat);
              setArtifact(null);
            }}
            options={formats.map((f) => ({ value: f, label: FORMAT_LABEL[f] }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={`${ids}-material`}>
          Material
          <NativeSelect
            id={`${ids}-material`}
            value={material}
            data-testid="export-char-material"
            onChange={(event) => setMaterial(event.currentTarget.value as '' | 'unlit' | 'lit')}
            options={MATERIAL_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={`${ids}-file`}>
          File name
          <TextInput
            id={`${ids}-file`}
            value={fileName ?? name}
            data-testid="export-char-filename"
            onChange={(event) => setFileName(event.currentTarget.value)}
          />
        </label>
      </div>
      <section className="flex flex-col gap-1.5" aria-label="Clips">
        <h3 className="text-ui font-semibold text-fg-2">Clips</h3>
        {pkg ? (
          <p className="text-ui text-fg-3" data-testid="export-char-package-clips">
            The clips of your target’s slots (Windows › Target), each named by its slot:{' '}
            {clips
              .filter((clip) => clip.slot?.includes('.') === true)
              .map((clip) => clip.name)
              .join(', ') || 'none yet'}
            .
          </p>
        ) : null}
        {pkg ? null : clips.length === 0 ? (
          <p className="text-ui text-fg-3">No clips: the avatar exports without animations (OMOBA brings its own).</p>
        ) : null}
        <ul className="flex max-h-32 flex-col gap-0.5 overflow-auto">
          {(pkg ? [] : clips).map((clip) => (
            <li key={clip.id}>
              <Checkbox
                checked={chosen.has(clip.id)}
                data-testid={`export-char-clip-${clip.id}`}
                onChange={(event) => {
                  const next = new Set(chosen);
                  if (event.currentTarget.checked) next.add(clip.id);
                  else next.delete(clip.id);
                  setChosenClips(next);
                }}
                label={
                  <span>
                    {clip.name} <span className="text-fg-3">{clip.slot === null ? '(no slot)' : `→ ${clip.slot}`}</span>
                  </span>
                }
              />
            </li>
          ))}
        </ul>
        <Checkbox checked disabled data-testid="export-char-props" label="Include props (none in this character)" />
      </section>
      {character !== null && format === 'vrm' ? (
        <section className="grid gap-3 md:grid-cols-[auto_1fr]" aria-label="VRM meta">
          <ThumbnailPreview app={app} character={character} run={(op, args) => shell.runFromUi(op, args)} />
          <VrmMetaFields app={app} character={character} run={(op, args) => shell.runFromUi(op, args)} />
        </section>
      ) : null}
      <section className="flex flex-col gap-1.5" aria-label="Validation">
        <h3 className="text-ui font-semibold text-fg-2">
          Validation ({profiles.find((p) => p.id === profile)?.label ?? 'no profile'})
        </h3>
        <CharacterChecks rows={rows} />
      </section>
      <section data-testid="export-lints" aria-label="Export results" aria-live="polite">
        {error === null ? null : (
          <p className="text-ui text-danger" role="alert">
            {error}
          </p>
        )}
        {artifact === null ? null : <ArtifactResult artifact={artifact} />}
      </section>
      <DialogFooter>
        {blocked === null ? null : (
          <span className="mr-auto self-center text-ui text-fg-3" data-testid="export-char-blocked">
            {blocked}
          </span>
        )}
        <Button variant="ghost" onClick={props.onCancel}>
          {artifact === null ? 'Cancel' : 'Close'}
        </Button>
        {pkg && character !== null ? (
          <Button
            variant="ghost"
            disabled={blocked !== null || running}
            data-testid="export-char-devzip"
            onClick={() =>
              void shell.runFromUi('target.exportPackage', { character, devZip: true, fileName: fileName ?? name })
            }
          >
            Developer zip
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={blocked !== null || running}
          data-testid="export-confirm"
          onClick={() => void run()}
        >
          {running ? 'Exporting…' : 'Export'}
        </Button>
      </DialogFooter>
    </div>
  );
}
