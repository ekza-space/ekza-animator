// Export dialog (research 09 §10.4; MVP-SPEC §4.11.10, §7 WP-8): kind (bake into the model, animation-only GLB,
// VRMA), clips, export profile, licence acknowledgement, interop and node-constraint warnings, then `file.export`
// and its lints and read-back results.
import type { CharacterId, ClipId, DocumentStore } from '@ekza-animator/doc';
import type { EditorApp, ExporterDef } from '@ekza-animator/editor-core';
import { type ExportArtifact, type ExportRequest, readVrmLicense } from '@ekza-animator/io';
import {
  Badge,
  Button,
  Checkbox,
  CircleCheck,
  Dialog,
  DialogContent,
  DialogFooter,
  NativeSelect,
  RadioGroup,
  RadioGroupItem,
  TextInput,
  TriangleAlert,
} from '@ekza-animator/ui';
import { type JSX, useId, useMemo, useState } from 'react';
import { useDocQuery, useSession } from '../hooks';
import { useRegistryList } from '../hooks/useRegistry';
import { useShell } from '../shell/context';
import { asArtifacts } from '../shell/exports';
import { isRestricted } from '../shell/summary';

const KIND_HINT: Readonly<Record<string, string>> = {
  'bake-into-model': 'Writes a copy of your .vrm/.glb with the clips appended; every original byte is kept.',
  'animation-glb': 'Skeleton and clips only, for engines and other tools.',
  vrma: 'One VRM Animation file per clip; plays on any VRM humanoid.',
};

interface CharacterOption {
  readonly id: CharacterId;
  readonly name: string;
  readonly format: string;
}

function characterOptions(store: DocumentStore): CharacterOption[] {
  return store.list('characters').map((c) => ({ id: c.id, name: c.name, format: c.format }));
}

/** False only for a loaded clip without a single key (an unopened partition counts as animated). */
function hasKeys(store: DocumentStore, clip: ClipId): boolean {
  if (!store.isOpen(`clip:${clip}`)) return true;
  return store.query.curvesOfClip(clip).some((curve) => store.query.keysOfCurve(curve.id).length > 0);
}

function clipOptions(store: DocumentStore, character: CharacterId | null) {
  if (character === null) return [];
  return store.query.clipsOfCharacter(character).map((clip) => ({
    id: clip.id,
    name: clip.name,
    fps: clip.fps.num / clip.fps.den,
    start: clip.range.start,
    end: clip.range.end,
    loop: clip.loop,
    animated: hasKeys(store, clip.id),
  }));
}

/** A count with its noun in the right number: `1 clip`, `0 clips`, `3 clips`. */
export function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

/** The result line of an exported file: `1 clip · 3 channels · 1 key`. */
export function statsLine(stats: ExportArtifact['stats']): string {
  return [count(stats.clips, 'clip'), count(stats.channels, 'channel'), count(stats.keys, 'key')].join(' · ');
}

/** Warnings shown before export (research 09 §10.4, ADR 0010): interop limits and preview-only rig features. */
export function exportWarnings(app: EditorApp, character: CharacterId | null, kind: string): string[] {
  if (character === null) return [];
  const warnings: string[] = [];
  const record = app.store.get('characters', character);
  const runtime = app.characters.get(character);
  if (kind === 'vrma' && record !== undefined && record.format === 'gltf') {
    warnings.push('VRMA needs a VRM humanoid; this character is a plain glTF model.');
  }
  if (kind === 'vrma') {
    warnings.push('VRMA keeps humanoid bones only (and hips translation); other animated joints are dropped.');
  }
  const constraints = runtime?.skeleton.nodeConstraints.length ?? 0;
  if (constraints > 0) {
    const one = constraints === 1;
    const follow = one ? 'follows its source' : 'follow their sources';
    warnings.push(
      kind === 'bake-into-model'
        ? `${count(constraints, 'VRMC_node_constraint target')} ${follow} in the preview; ${one ? 'it is' : 'they are'} not baked (VRM apps evaluate ${one ? 'it' : 'them'}).`
        : `${count(constraints, 'constrained node')} ${follow} only in the preview and ${one ? 'is' : 'are'} not exported.`,
    );
  }
  if ((runtime?.skeleton.springJoints.length ?? 0) > 0) {
    warnings.push('Spring bones are preview-only and never baked.');
  }
  return warnings;
}

function pollExporter(app: EditorApp, exporter: ExporterDef | undefined, request: ExportRequest): string | null {
  if (exporter === undefined) return 'This export kind is not available in this build';
  if (request.clips.length === 0) return 'Select at least one clip';
  try {
    const result = exporter.poll(app, request);
    return result === true ? null : result.reason;
  } catch (error) {
    return error instanceof Error ? error.message : 'Not available';
  }
}

function Results(props: { readonly artifacts: readonly ExportArtifact[] }): JSX.Element {
  return (
    <ul className="flex flex-col gap-2">
      {props.artifacts.map((artifact) => (
        <li key={artifact.fileName} className="rounded-button border border-line bg-field p-2">
          <div className="flex flex-wrap items-center gap-2 text-ui">
            <CircleCheck size={14} className="text-ok" />
            <span className="font-semibold text-fg">{artifact.fileName}</span>
            <span className="text-fg-3" data-testid="export-stats">
              {statsLine(artifact.stats)}
            </span>
            {artifact.readBack === null ? null : (
              <Badge tone={artifact.readBack.ok ? 'ok' : 'danger'}>
                {artifact.readBack.ok ? 'Read-back OK' : 'Read-back failed'}
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
        </li>
      ))}
    </ul>
  );
}

/**
 * Clips checked when the dialog opens (until the user changes them): every clip of the character for the containers
 * that hold several clips (bake into the model, animation-only GLB), the active clip for VRMA, which writes one file
 * per clip (acceptance round 1: baking usually wants all clips). Clips without a single key (an imported animation
 * that moved no joint, a new empty clip) would only write the rest pose: they start unchecked unless every clip is
 * empty (acceptance round 2).
 */
export function defaultExportClips(
  kind: string,
  clips: readonly { readonly id: ClipId; readonly animated?: boolean }[],
  active: ClipId | undefined,
): ReadonlySet<ClipId> {
  if (kind === 'vrma') return new Set(clips.filter((clip) => clip.id === active).map((clip) => clip.id));
  const animated = clips.filter((clip) => clip.animated !== false);
  return new Set((animated.length > 0 ? animated : clips).map((clip) => clip.id));
}

export function ExportDialog(): JSX.Element {
  const shell = useShell();
  const { app } = shell;
  const exporters = useRegistryList(app.exporters);
  const profiles = useRegistryList(app.exportProfiles);
  const characters = useDocQuery(characterOptions, ['characters']);
  const activeCharacter = useSession((s) => s.activeCharacter);
  const activeClips = useSession((s) => s.activeClip);
  const [characterChoice, setCharacterChoice] = useState<CharacterId | null>(null);
  const character = characterChoice ?? activeCharacter ?? characters[0]?.id ?? null;
  const clips = useDocQuery((store) => clipOptions(store, character), ['clips', 'characters', 'curves', 'keys']);

  const [kind, setKind] = useState<string>(() => exporters[0]?.id ?? 'bake-into-model');
  const [selectedClips, setSelectedClips] = useState<ReadonlySet<ClipId> | null>(null);
  const [pattern, setPattern] = useState<string | null>(null);
  const [profile, setProfile] = useState<string>('');
  const [closeLoopChoice, setCloseLoop] = useState<boolean | null>(null);
  const [includeConstantTracks, setIncludeConstantTracks] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [artifacts, setArtifacts] = useState<readonly ExportArtifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  const defaultClip = character === null ? undefined : activeClips[character];
  const chosenClips = selectedClips ?? defaultExportClips(kind, clips, defaultClip);
  const chosen = clips.filter((clip) => chosenClips.has(clip.id));
  // §4.11.10: loop closure defaults on for loop clips.
  const closeLoop = closeLoopChoice ?? (chosen.length > 0 && chosen.every((clip) => clip.loop));
  const exporter = exporters.find((candidate) => candidate.id === kind);
  const kindProfiles = profiles.filter((candidate) => candidate.kind === kind);
  const fileNamePattern = pattern ?? (kind === 'bake-into-model' ? '{character}' : '{character}_{clip}');

  const restricted = useMemo(() => {
    if (character === null) return false;
    const runtime = app.characters.get(character);
    if (runtime === undefined) return false;
    try {
      return isRestricted(readVrmLicense(runtime.container));
    } catch {
      return false;
    }
  }, [app, character]);
  const needsAck = restricted && kind === 'bake-into-model';

  const request: ExportRequest | null =
    character === null
      ? null
      : {
          kind,
          character,
          clips: chosen.map((clip) => clip.id),
          fileNamePattern,
          closeLoop,
          includeConstantTracks,
          acknowledgeLicense: acknowledged,
          profile: kindProfiles.some((candidate) => candidate.id === profile) ? profile : null,
        };
  const blocked =
    request === null
      ? 'Load a character to export'
      : (pollExporter(app, exporter, request) ?? (needsAck && !acknowledged ? 'Acknowledge the licence first' : null));
  const warnings = exportWarnings(app, character, kind);

  const run = async (): Promise<void> => {
    if (request === null) return;
    setRunning(true);
    setError(null);
    try {
      const result = await shell.runFromUi('file.export', request);
      if (result.status === 'finished') setArtifacts(asArtifacts(result.value) ?? []);
      else setError(result.status === 'failed' ? result.error.message : result.reason);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void shell.runFromUi('ui.close');
      }}
    >
      <DialogContent title="Export" width="lg" data-testid="export-dialog">
        <div className="flex flex-col gap-4">
          {characters.length > 1 ? (
            <label className="flex items-center gap-2 text-ui text-fg-2" htmlFor={`${ids}-character`}>
              Character
              <NativeSelect
                id={`${ids}-character`}
                value={character ?? ''}
                data-testid="export-character"
                onChange={(event) => {
                  setCharacterChoice(event.currentTarget.value as CharacterId);
                  setSelectedClips(null);
                }}
                options={characters.map((c) => ({ value: c.id, label: c.name }))}
              />
            </label>
          ) : null}
          <RadioGroup
            value={kind}
            onValueChange={(value) => {
              setKind(value);
              setArtifacts(null);
            }}
            aria-label="Export kind"
            className="grid gap-1.5 md:grid-cols-3"
          >
            {exporters.map((candidate) => (
              <RadioGroupItem
                key={candidate.id}
                value={candidate.id}
                label={candidate.label}
                hint={KIND_HINT[candidate.id]}
                data-testid={`export-kind-${candidate.id}`}
              />
            ))}
          </RadioGroup>
          {exporters.length === 0 ? (
            <p className="text-ui text-fg-3">No exporters are available in this build.</p>
          ) : null}
          <section className="flex flex-col gap-1.5" aria-label="Clips">
            <h3 className="text-ui font-semibold text-fg-2">Clips</h3>
            {clips.length === 0 ? <p className="text-ui text-fg-3">This character has no clips.</p> : null}
            <ul className="flex max-h-40 flex-col gap-0.5 overflow-auto">
              {clips.map((clip) => (
                <li key={clip.id}>
                  <Checkbox
                    checked={chosenClips.has(clip.id)}
                    data-testid={`export-clip-${clip.id}`}
                    onChange={(event) => {
                      const next = new Set(chosenClips);
                      if (event.currentTarget.checked) next.add(clip.id);
                      else next.delete(clip.id);
                      setSelectedClips(next);
                    }}
                    label={
                      <span>
                        {clip.name}{' '}
                        <span className="ekza-numeric text-fg-3">
                          ({clip.start}–{clip.end}, {Number(clip.fps.toFixed(3))} fps)
                        </span>
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={`${ids}-profile`}>
              Profile
              <NativeSelect
                id={`${ids}-profile`}
                value={kindProfiles.some((candidate) => candidate.id === profile) ? profile : ''}
                data-testid="export-profile"
                onChange={(event) => setProfile(event.currentTarget.value)}
                options={[
                  { value: '', label: 'Generic (no target profile)' },
                  ...kindProfiles.map((candidate) => ({ value: candidate.id, label: candidate.label })),
                ]}
              />
            </label>
            <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={`${ids}-filename`}>
              File name
              <TextInput
                id={`${ids}-filename`}
                value={fileNamePattern}
                data-testid="export-filename"
                onChange={(event) => setPattern(event.currentTarget.value)}
              />
              <span className="text-ui-dense text-fg-3">
                Tokens: {'{character}'} {'{clip}'} {'{fps}'}
              </span>
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            <Checkbox
              checked={closeLoop}
              onChange={(event) => setCloseLoop(event.currentTarget.checked)}
              data-testid="export-close-loop"
              label="Close loops (last frame equals the first)"
            />
            <Checkbox
              checked={includeConstantTracks}
              onChange={(event) => setIncludeConstantTracks(event.currentTarget.checked)}
              data-testid="export-constant-tracks"
              label="Include constant tracks"
            />
          </div>
          {needsAck ? (
            <div className="flex flex-col gap-1 rounded-button border border-warn/60 p-2">
              <p className="flex items-start gap-1.5 text-ui text-warn">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                The avatar's VRM licence forbids modification or redistribution. Baking writes a modified copy of the
                model.
              </p>
              <Checkbox
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.currentTarget.checked)}
                data-testid="export-ack-license"
                label="For personal use; I will not redistribute the baked model"
              />
            </div>
          ) : null}
          {warnings.length === 0 ? null : (
            <ul className="flex flex-col gap-1" data-testid="export-warnings">
              {warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-1.5 text-ui text-fg-2">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warn" />
                  {warning}
                </li>
              ))}
            </ul>
          )}
          <section data-testid="export-lints" aria-label="Export results" aria-live="polite">
            {error === null ? null : (
              <p className="text-ui text-danger" role="alert">
                {error}
              </p>
            )}
            {artifacts === null ? null : <Results artifacts={artifacts} />}
          </section>
        </div>
        <DialogFooter>
          {blocked === null ? null : <span className="mr-auto self-center text-ui text-fg-3">{blocked}</span>}
          <Button variant="ghost" onClick={() => void shell.runFromUi('ui.close')}>
            {artifacts === null ? 'Cancel' : 'Close'}
          </Button>
          <Button
            variant="primary"
            disabled={blocked !== null || running}
            data-testid="export-confirm"
            onClick={() => void run()}
          >
            {running ? 'Exporting…' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
