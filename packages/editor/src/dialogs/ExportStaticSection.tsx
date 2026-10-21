// The Export dialog's "Static model (GLB)" section (M6A-SPEC §8.8, §5.19, §5.21, §5.22; B13 over B8's
// `file.exportModel`): the export roots (the selected objects, else the scene roots; only those holding a mesh), the
// profile (`local/generic`, `ekza/omoba-handheld-v1`; a handheld template root defaults to the latter), the colour
// output and material preset (each mesh's own unless overridden), Drop tangents (only when a made-editable mesh's glTF
// primitives carried tangents), the file name, then the lints, the validator's result and the file size of what was
// written.
import type { DocumentStore, GroupRecord, MeshRecord } from '@ekza-studio/doc';
import { type EditorApp, topmost } from '@ekza-studio/editor-core';
import type { ExportArtifact, StaticExportRequest } from '@ekza-studio/io';
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
import { type JSX, useId, useMemo, useState } from 'react';
import { useDocQuery, useSession } from '../hooks';
import { useRegistryList } from '../hooks/useRegistry';
import { markModelExported } from '../panels/viewport/modelProgress';
import { useShell } from '../shell/context';

type SceneObject = MeshRecord | GroupRecord;

const COLOUR_OPTIONS = [
  { value: '', label: "Each mesh's own" },
  { value: 'palette-texture', label: 'Palette texture' },
  { value: 'vertex-colour', label: 'Vertex colours (COLOR_0)' },
  { value: 'material-per-colour', label: 'One material per colour' },
] as const;
const MATERIAL_OPTIONS = [
  { value: '', label: "Each mesh's own" },
  { value: 'unlit', label: 'Unlit' },
  { value: 'lit', label: 'Lit' },
] as const;
const HANDHELD_PROFILE = 'ekza/omoba-handheld-v1';
const GENERIC_PROFILE = 'local/generic';

/** Whether a scene object is a mesh or a group whose subtree holds one (a mesh-less group exports an empty node). */
export function holdsMesh(store: DocumentStore, object: SceneObject): boolean {
  if (object.id.startsWith('msh_')) return true;
  const owner = 'scene' in object.owner ? 'scene' : object.owner.character;
  return store.query.childrenOf(object.id, owner).some((child) => holdsMesh(store, child));
}

/**
 * The export roots: the topmost selected scene objects, else every scene root — in both cases only those that hold a
 * mesh (Humanoid guides and empty groups are left out; a selection of only those exports nothing).
 */
export function staticRoots(store: DocumentStore, selected: readonly string[]): readonly SceneObject[] {
  const chosen = topmost(store, selected);
  const roots = chosen.length > 0 ? chosen : store.query.childrenOf(null, 'scene');
  return roots.filter((root) => holdsMesh(store, root));
}

/** Whether a made-editable mesh among the roots came from glTF primitives with TANGENT (Drop tangents applies). */
export function needsDropTangents(app: EditorApp, store: DocumentStore, roots: readonly SceneObject[]): boolean {
  const visit = (object: SceneObject): boolean => {
    if (object.id.startsWith('msh_')) {
      const mesh = object as MeshRecord;
      if (mesh.source !== null && 'character' in mesh.owner) {
        const json = app.characters.get(mesh.owner.character)?.container.json;
        const gltfMesh = (Array.isArray(json?.['meshes']) ? (json['meshes'] as unknown[]) : [])[mesh.source.mesh] as
          | { primitives?: { attributes?: Record<string, unknown> }[] }
          | undefined;
        if (gltfMesh?.primitives?.some((p) => p.attributes?.['TANGENT'] !== undefined) === true) return true;
      }
    }
    const owner = 'scene' in object.owner ? 'scene' : object.owner.character;
    return store.query.childrenOf(object.id, owner).some(visit);
  };
  return roots.some(visit);
}

const isHandheldRoot = (object: SceneObject): boolean => object.handheld !== null;

function defaultFileName(roots: readonly SceneObject[]): string {
  const base = roots.length === 1 ? (roots[0]?.name ?? 'model') : 'model';
  return `${base.replace(/[^\w.-]+/g, '_') || 'model'}.glb`;
}

function bytesLabel(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1_048_576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1_048_576).toFixed(2)} MB`;
}

export function ExportStaticSection(props: { readonly onCancel: () => void }): JSX.Element {
  const shell = useShell();
  const { app } = shell;
  const ids = useId();
  const profiles = useRegistryList(app.exportProfiles);
  const selected = useSession((s) => s.selection.objects);
  const read = useMemo(
    () => (store: DocumentStore) => {
      const roots = staticRoots(store, selected);
      return { roots, tangents: needsDropTangents(app, store, roots) };
    },
    [app, selected],
  );
  const { roots, tangents } = useDocQuery(read, ['meshes', 'groups']);
  const staticProfiles = profiles.filter((p) => p.kind === 'static-glb' || p.kind === '*');
  const handheld = roots.length === 1 && roots[0] !== undefined && isHandheldRoot(roots[0]);
  const [profileChoice, setProfile] = useState<string | null>(null);
  const profile = profileChoice ?? (handheld ? HANDHELD_PROFILE : GENERIC_PROFILE);
  const [colour, setColour] = useState('');
  const [material, setMaterial] = useState('');
  const [dropTangents, setDropTangents] = useState(false);
  const [fileChoice, setFileName] = useState<string | null>(null);
  const fileName = fileChoice ?? defaultFileName(roots);
  const [running, setRunning] = useState(false);
  const [artifacts, setArtifacts] = useState<readonly ExportArtifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request: StaticExportRequest = {
    objects: roots.map((root) => root.id),
    fileName: fileName.toLowerCase().endsWith('.glb') ? fileName : `${fileName}.glb`,
    profile,
    ...(colour === '' ? {} : { colourOutput: colour as NonNullable<StaticExportRequest['colourOutput']> }),
    ...(material === '' ? {} : { materialPreset: material as 'unlit' | 'lit' }),
    ...(tangents && dropTangents ? { dropTangents: true } : {}),
  };
  const blocked =
    roots.length > 0
      ? null
      : selected.length > 0
        ? 'Nothing to export: the selection holds no mesh'
        : 'Nothing to export: create or select a mesh';

  const run = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    setArtifacts(null);
    try {
      const result = await app.runUntyped('file.exportModel', request, { panel: 'global', source: 'menu' });
      if (result.status === 'finished') {
        setArtifacts(result.value as readonly ExportArtifact[]);
        markModelExported(app);
      } else setError(result.status === 'failed' ? result.error.message : result.reason);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4" data-testid="export-static-body">
        <section className="flex flex-col gap-1 text-ui text-fg-2" aria-label="Export roots">
          <h3 className="font-semibold">Exports</h3>
          {roots.length === 0 ? (
            <p className="text-fg-3">No scene mesh yet.</p>
          ) : (
            <p className="text-fg" data-testid="export-static-roots">
              {roots.map((root) => root.name).join(', ')}
              <span className="text-fg-3"> {selected.length > 0 ? '(selected)' : '(every scene object)'}</span>
            </p>
          )}
        </section>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={`${ids}-profile`}>
            Profile
            <NativeSelect
              id={`${ids}-profile`}
              value={profile}
              data-testid="export-static-profile"
              onChange={(event) => setProfile(event.currentTarget.value)}
              options={staticProfiles.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={`${ids}-file`}>
            File name
            <TextInput
              id={`${ids}-file`}
              value={fileName}
              data-testid="export-static-filename"
              onChange={(event) => setFileName(event.currentTarget.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={`${ids}-colour`}>
            Colour output
            <NativeSelect
              id={`${ids}-colour`}
              value={colour}
              data-testid="export-static-colour"
              onChange={(event) => setColour(event.currentTarget.value)}
              options={COLOUR_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={`${ids}-material`}>
            Material
            <NativeSelect
              id={`${ids}-material`}
              value={material}
              data-testid="export-static-material"
              onChange={(event) => setMaterial(event.currentTarget.value)}
              options={MATERIAL_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
          </label>
        </div>
        {tangents ? (
          <Checkbox
            checked={dropTangents}
            onChange={(event) => setDropTangents(event.currentTarget.checked)}
            data-testid="export-static-drop-tangents"
            label="Drop tangents (an edited mesh had them; tangent generation arrives with mesh-wasm in M7)"
          />
        ) : null}
        <section data-testid="export-static-results" aria-label="Export results" aria-live="polite">
          {error === null ? null : (
            <p className="text-ui text-danger" role="alert">
              {error}
            </p>
          )}
          {artifacts === null ? null : <StaticResults artifacts={artifacts} />}
        </section>
      </div>
      <DialogFooter>
        {blocked === null ? null : <span className="mr-auto self-center text-ui text-fg-3">{blocked}</span>}
        <Button variant="ghost" onClick={props.onCancel}>
          {artifacts === null ? 'Cancel' : 'Close'}
        </Button>
        <Button
          variant="primary"
          disabled={blocked !== null || running}
          data-testid="export-static-confirm"
          onClick={() => void run()}
        >
          {running ? 'Exporting…' : 'Export'}
        </Button>
      </DialogFooter>
    </>
  );
}

function StaticResults(props: { readonly artifacts: readonly ExportArtifact[] }): JSX.Element {
  return (
    <ul className="flex flex-col gap-2">
      {props.artifacts.map((artifact) => {
        const errors = artifact.lints.filter((lint) => lint.severity === 'error').length;
        return (
          <li key={artifact.fileName} className="rounded-button border border-line bg-field p-2">
            <div className="flex flex-wrap items-center gap-2 text-ui">
              {errors === 0 ? (
                <CircleCheck size={14} className="text-ok" />
              ) : (
                <TriangleAlert size={14} className="text-danger" />
              )}
              <span className="font-semibold text-fg">{artifact.fileName}</span>
              <span className="ekza-numeric text-fg-3" data-testid="export-static-size">
                {bytesLabel(artifact.bytes.length)}
              </span>
              {artifact.validation === null ? (
                <Badge tone="info">Validator not run</Badge>
              ) : (
                <Badge tone={artifact.validation.errors === 0 ? 'ok' : 'danger'} data-testid="export-static-validator">
                  Validator: {artifact.validation.errors} errors, {artifact.validation.warnings} warnings
                </Badge>
              )}
              {errors === 0 ? null : <span className="text-danger">Not saved: fix the errors below</span>}
            </div>
            {artifact.lints.length === 0 ? (
              <p className="mt-1 text-ui text-fg-3">No lint issues.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-0.5" data-testid="export-static-lints">
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
        );
      })}
    </ul>
  );
}
