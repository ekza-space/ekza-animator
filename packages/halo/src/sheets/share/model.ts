// Share, destination first (STUDIO-TOUCH-SPEC §7.3, §13.3, §15 rows 11.4–11.9; T11): which export each destination
// runs for the character or the scene in hand, with Studio Pro's or Auto-Rig's own arguments, so the bytes are theirs
// (AS-ST-5). Pure over the app: no React, no kernel imports beyond editor-core's root.
//
// | Destination | Subject | Call (the same request as) |
// |---|---|---|
// | OMOBA & Ekza Space | a model character bound to a game target | `target.exportPackage {character}` — C2's hero package (`ekza/omoba-humanoid-v2`, the target's slot clips; Pro's *OMOBA character* profile, Auto-Rig's `omoba-hero`) |
// |  | a model character | `file.exportCharacter` with Pro's Character section defaults (`ekza/space-avatar-v1`, VRM 1.0, slot clips) |
// |  | an imported VRM | `autorig.export {target: 'ekza-vrm'}` (Auto-Rig ⑤: the bake through `ekza/space-avatar-v1`) |
// | Game engine | a model character or an imported glTF | `autorig.export {target: 'glb'}` (Auto-Rig ⑤: one GLB, `local/generic`, every animation) |
// | Just the animations | any character | `autorig.export {target: 'vrma'}` (one VRMA, or several in a zip) |
// | Prop for OMOBA | the scene's meshes (the selection first) | `file.exportModel` with Pro's Static section request and `ekza/omoba-handheld-v1` |
// | Into the original file | an imported character | `file.export {kind: 'bake-into-model'}` with Pro's Export dialog defaults |
//
// More formats: VRM 0.x kept (the bake of a VRM 0.x), rigged GLB (Pro's Character section, `local/generic`, GLB),
// the OMOBA local test kit (`autorig.export {target: 'omoba-kit'}`; a bound character's developer zip,
// `target.exportPackage {devZip: true}`), animation-only GLB (`file.export {kind: 'animation-glb'}`) and the static
// model (`file.exportModel`, `local/generic`). Advanced changes only what Pro's dialog lets you change for the same
// call (key reduction, loops, constant tracks, the licence acknowledgement, materials, colours); its defaults are
// Pro's, so an untouched card writes Pro's bytes.
import type {
  CharacterId,
  CharacterRecord,
  ClipId,
  ClipRecord,
  DocumentStore,
  GroupRecord,
  MeshRecord,
  ReadView,
} from '@ekza-studio/doc';
import { type EditorApp, PANEL, type RunContext, topmost } from '@ekza-studio/editor-core';
import type { DestinationId } from '../../path/destinations';

export const SPACE_PROFILE = 'ekza/space-avatar-v1';
export const PACKAGE_PROFILE = 'ekza/omoba-humanoid-v2';
export const GENERIC_PROFILE = 'local/generic';
export const HANDHELD_PROFILE = 'ekza/omoba-handheld-v1';
export const VRMA_PROFILE = 'ekza/vrma-humanoid-v1';

/** The run context of Share's calls (the host's funnel takes the viewport's panel). */
export const SHARE_CONTEXT: RunContext = { panel: PANEL.viewport, paneId: 'pane-single' };

export type ShareOp =
  | 'file.exportCharacter'
  | 'file.export'
  | 'file.exportModel'
  | 'autorig.export'
  | 'target.exportPackage';

/** One export: the operator, its arguments and what Advanced names (format, profile). */
export interface ShareCall {
  readonly op: ShareOp;
  readonly args: Readonly<Record<string, unknown>>;
  /** The format name (Advanced only, §17: format names are never choices at the first layers). */
  readonly format: string;
  readonly profile: string | null;
}

/** Advanced ▾ (§13.3): every option; `null` = Studio Pro's default for the call. */
export interface ShareOptions {
  /** Fewer keys on export (Pro: the dialog's *Reduce keys*, from the preference). */
  readonly reduce: boolean | null;
  /** Close loops (Pro: on when every chosen animation loops). */
  readonly closeLoop: boolean | null;
  readonly constantTracks: boolean;
  /** The licence acknowledgement of a bake whose VRM licence forbids changes (Pro's checkbox). */
  readonly acknowledge: boolean;
  /** Materials as each mesh's own, unlit or lit (Pro's *Material*). */
  readonly material: 'unlit' | 'lit' | null;
  /** Colours as (static models; Pro's *Colour output*). */
  readonly colourOutput: 'palette-texture' | 'vertex-colour' | 'material-per-colour' | null;
}

export const DEFAULT_OPTIONS: ShareOptions = {
  reduce: null,
  closeLoop: null,
  constantTracks: true,
  acknowledge: false,
  material: null,
  colourOutput: null,
};

/** What Share exports for: the live character in hand (and how it was made), or none. */
export interface ShareSubject {
  readonly character: CharacterRecord | null;
  /** model: made or rigged in Ekza Studio; vrm / vrm0 / gltf: an imported avatar of that format. */
  readonly kind: 'model' | 'vrm' | 'vrm0' | 'gltf' | null;
  /** A model character bound to a game target (CHARACTER-CONTRACT-SPEC §8.2). */
  readonly bound: boolean;
  /** The name the avatar is shown and named by (a model character's VRM name, else its own). */
  readonly name: string;
}

const isLive = (record: { readonly deleted: unknown }): boolean => record.deleted === null;

/** The raw `ekza.targets` row of a character (the target chunk need not be loaded; Auto-Rig reads it the same way). */
export function boundToTarget(app: EditorApp, character: CharacterId): boolean {
  const row = (app.store as unknown as { get(table: string, id: string): unknown }).get(
    'ekza.targets',
    `tgt:${character}`,
  );
  return typeof row === 'object' && row !== null && (row as { deleted?: unknown }).deleted === null;
}

/** The character Share exports: the one Rig shows, else the active one, else the first live one. */
export function shareSubject(app: EditorApp): ShareSubject {
  const s = app.session.getState();
  const live = app.store.list('characters').filter(isLive);
  const wanted = s.rig.character ?? s.activeCharacter;
  const character = live.find((c) => c.id === wanted) ?? live[0] ?? null;
  if (character === null) return { character: null, kind: null, bound: false, name: '' };
  const model = character.source.kind === 'model';
  const vrmName = model ? (character.vrm?.name ?? '').trim() : '';
  return {
    character,
    kind: model ? 'model' : character.format === 'vrm0' ? 'vrm0' : character.format === 'vrm1' ? 'vrm' : 'gltf',
    bound: model && boundToTarget(app, character.id),
    name: vrmName === '' ? character.name : vrmName,
  };
}

// ---------- Studio Pro's own requests ----------

/** False only for a loaded clip without a single key (Pro's Export dialog: an unopened partition counts). */
function hasKeys(store: DocumentStore, clip: ClipId): boolean {
  if (!store.isOpen(`clip:${clip}`)) return true;
  return store.query.curvesOfClip(clip).some((curve) => store.query.keysOfCurve(curve.id).length > 0);
}

/**
 * Pro's Export dialog's checked clips (`defaultExportClips`): every animated clip of the character for the containers
 * that hold several (bake, animation-only GLB), every clip when none is animated.
 */
export function proExportClips(app: EditorApp, character: CharacterId): readonly ClipRecord[] {
  const clips = app.store.query.clipsOfCharacter(character);
  const animated = clips.filter((clip) => hasKeys(app.store, clip.id));
  return animated.length > 0 ? animated : clips;
}

/** Pro's `file.export` request for a character (its dialog's defaults, then Advanced). */
export function proFileExport(
  app: EditorApp,
  character: CharacterId,
  kind: 'bake-into-model' | 'animation-glb',
  options: ShareOptions,
): Readonly<Record<string, unknown>> {
  const clips = proExportClips(app, character);
  const prefs = app.prefs.getState().exportReduce;
  const reduce = options.reduce ?? prefs.enabled;
  return {
    kind,
    character,
    clips: clips.map((clip) => clip.id),
    fileNamePattern: kind === 'bake-into-model' ? '{character}' : '{character}_{clip}',
    closeLoop: options.closeLoop ?? (clips.length > 0 && clips.every((clip) => clip.loop)),
    includeConstantTracks: options.constantTracks,
    acknowledgeLicense: options.acknowledge,
    profile: null,
    reduce: reduce
      ? {
          positionM: prefs.positionM,
          rotationCapRad: prefs.rotationCapRad,
          minLeverM: prefs.minLeverM,
          scaleRel: prefs.scaleRel,
        }
      : null,
  };
}

/** Pro's Character section request (`ExportCharacterSection`): its defaults for a profile and a format. */
export function proCharacterExport(
  record: CharacterRecord,
  profile: string,
  format: 'vrm' | 'glb',
  options: ShareOptions,
): Readonly<Record<string, unknown>> {
  return {
    character: record.id,
    fileName: record.name,
    format,
    profile,
    clips: profile === PACKAGE_PROFILE ? 'target' : 'slots',
    includeProps: null,
    material: options.material,
    thumbnail: format === 'vrm' ? 'stored' : 'none',
    validate: true,
  };
}

type SceneObject = MeshRecord | GroupRecord;

/** Whether a scene object is a mesh or a group holding one (Pro's `holdsMesh`). */
function holdsMesh(view: ReadView, object: SceneObject): boolean {
  if (object.id.startsWith('msh_')) return true;
  const owner = 'scene' in object.owner ? 'scene' : object.owner.character;
  return view.query.childrenOf(object.id, owner).some((child) => holdsMesh(view, child));
}

/** Pro's static export roots (`staticRoots`): the topmost selected objects, else the scene roots, holding a mesh. */
export function staticRoots(app: EditorApp): readonly SceneObject[] {
  const chosen = topmost(app.store, app.session.getState().selection.objects) as SceneObject[];
  const roots = chosen.length > 0 ? chosen : (app.store.query.childrenOf(null, 'scene') as SceneObject[]);
  return roots.filter((root) => holdsMesh(app.store, root));
}

/** Pro's Static section request (`ExportStaticSection`) for a profile, then Advanced. */
export function proStaticExport(
  app: EditorApp,
  profile: string,
  options: ShareOptions,
): Readonly<Record<string, unknown>> | null {
  const roots = staticRoots(app);
  if (roots.length === 0) return null;
  const base = roots.length === 1 ? (roots[0]?.name ?? 'model') : 'model';
  return {
    objects: roots.map((root) => root.id),
    fileName: `${base.replace(/[^\w.-]+/g, '_') || 'model'}.glb`,
    profile,
    ...(options.colourOutput === null ? {} : { colourOutput: options.colourOutput }),
    ...(options.material === null ? {} : { materialPreset: options.material }),
  };
}

const autorig = (character: CharacterId, target: string): ShareCall['args'] => ({ character, target, fileName: '' });

// ---------- destinations ----------

/** What a destination or a format can export now: its call, or why not (a plain sentence and where to fix it). */
export interface ShareChoice {
  readonly id: string;
  readonly call: ShareCall | null;
  /** Why there is nothing to export (no character, the wrong kind of model…), or null. */
  readonly problem: string | null;
  /** Where the problem is fixed: a stage, or another destination. */
  readonly go: { readonly stage?: 'make' | 'rig' | 'animate'; readonly destination?: DestinationId } | null;
}

const none = (id: string, problem: string, go: ShareChoice['go'] = null): ShareChoice => ({
  id,
  call: null,
  problem,
  go,
});
const call = (id: string, value: ShareCall): ShareChoice => ({ id, call: value, problem: null, go: null });

/** The words of the problems (Share's own; the vocabulary lint reads the catalogue, these name destinations only). */
export interface ShareWords {
  readonly noCharacter: string;
  readonly noScene: string;
  readonly madeHere: string;
  readonly isVrm: (name: string) => string;
  readonly notVrm: (name: string) => string;
  readonly notVrm0: string;
  readonly notBound: string;
}

/** The call of a destination for the document as it is (§7.3 table, §13.3). */
export function destinationChoice(
  app: EditorApp,
  destination: DestinationId,
  options: ShareOptions,
  words: ShareWords,
): ShareChoice {
  const subject = shareSubject(app);
  const record = subject.character;
  switch (destination) {
    case 'exploring':
      return none(destination, '');
    case 'prop': {
      const args = proStaticExport(app, HANDHELD_PROFILE, options);
      return args === null
        ? none(destination, words.noScene, { stage: 'make' })
        : call(destination, { op: 'file.exportModel', args, format: 'GLB (static)', profile: HANDHELD_PROFILE });
    }
    case 'omoba':
      if (record === null) return none(destination, words.noCharacter, { stage: 'rig' });
      if (subject.kind === 'model' && subject.bound) {
        return call(destination, {
          op: 'target.exportPackage',
          args: { character: record.id },
          format: 'VRM 1.0 (OMOBA package)',
          profile: PACKAGE_PROFILE,
        });
      }
      if (subject.kind === 'model') {
        return call(destination, {
          op: 'file.exportCharacter',
          args: proCharacterExport(record, SPACE_PROFILE, 'vrm', options),
          format: 'VRM 1.0',
          profile: SPACE_PROFILE,
        });
      }
      if (subject.kind === 'gltf') return none(destination, words.notVrm(record.name), { destination: 'engine' });
      return call(destination, {
        op: 'autorig.export',
        args: autorig(record.id, 'ekza-vrm'),
        format: subject.kind === 'vrm0' ? 'VRM 0.x (kept)' : 'VRM 1.0',
        profile: SPACE_PROFILE,
      });
    case 'engine':
      if (record === null) return none(destination, words.noCharacter, { stage: 'rig' });
      if (subject.kind === 'vrm' || subject.kind === 'vrm0') {
        return none(destination, words.isVrm(record.name), { destination: 'omoba' });
      }
      return call(destination, {
        op: 'autorig.export',
        args: autorig(record.id, 'glb'),
        format: 'GLB',
        profile: GENERIC_PROFILE,
      });
    case 'animations':
      if (record === null) return none(destination, words.noCharacter, { stage: 'rig' });
      return call(destination, {
        op: 'autorig.export',
        args: autorig(record.id, 'vrma'),
        format: 'VRMA',
        profile: null,
      });
    case 'original':
      if (record === null) return none(destination, words.noCharacter, { stage: 'rig' });
      if (subject.kind === 'model') return none(destination, words.madeHere, { destination: 'omoba' });
      return call(destination, {
        op: 'file.export',
        args: proFileExport(app, record.id, 'bake-into-model', options),
        format: subject.kind === 'gltf' ? 'GLB (your file)' : subject.kind === 'vrm0' ? 'VRM 0.x' : 'VRM 1.0',
        profile: null,
      });
  }
}

/** More formats ▸ (§13.3): the other files Pro and Auto-Rig write, each with the same call. */
export type MoreFormatId = 'vrm0' | 'rigged' | 'kit' | 'animationGlb' | 'static';
export const MORE_FORMATS: readonly MoreFormatId[] = ['vrm0', 'rigged', 'kit', 'animationGlb', 'static'];

export function moreFormatChoice(
  app: EditorApp,
  id: MoreFormatId,
  options: ShareOptions,
  words: ShareWords,
): ShareChoice {
  const subject = shareSubject(app);
  const record = subject.character;
  if (id === 'static') {
    const args = proStaticExport(app, GENERIC_PROFILE, options);
    return args === null
      ? none(id, words.noScene, { stage: 'make' })
      : call(id, { op: 'file.exportModel', args, format: 'GLB (static)', profile: GENERIC_PROFILE });
  }
  if (record === null) return none(id, words.noCharacter, { stage: 'rig' });
  switch (id) {
    case 'vrm0':
      if (subject.kind !== 'vrm0') return none(id, words.notVrm0);
      return call(id, {
        op: 'file.export',
        args: proFileExport(app, record.id, 'bake-into-model', options),
        format: 'VRM 0.x',
        profile: null,
      });
    case 'rigged':
      if (subject.kind === 'model') {
        return call(id, {
          op: 'file.exportCharacter',
          args: proCharacterExport(record, GENERIC_PROFILE, 'glb', options),
          format: 'GLB (rigged)',
          profile: GENERIC_PROFILE,
        });
      }
      if (subject.kind === 'gltf') {
        return call(id, {
          op: 'autorig.export',
          args: autorig(record.id, 'glb'),
          format: 'GLB',
          profile: GENERIC_PROFILE,
        });
      }
      return none(id, words.isVrm(record.name));
    case 'kit':
      if (subject.kind === 'model' && subject.bound) {
        return call(id, {
          op: 'target.exportPackage',
          args: { character: record.id, devZip: true },
          format: 'ZIP (developer files)',
          profile: PACKAGE_PROFILE,
        });
      }
      return call(id, {
        op: 'autorig.export',
        args: autorig(record.id, 'omoba-kit'),
        format: 'ZIP',
        profile: SPACE_PROFILE,
      });
    case 'animationGlb':
      return call(id, {
        op: 'file.export',
        args: proFileExport(app, record.id, 'animation-glb', options),
        format: 'GLB (animations only)',
        profile: null,
      });
  }
}

/** Why the operator refuses the call now (its poll), or null. */
export function callProblem(app: EditorApp, value: ShareCall): string | null {
  if (app.operators.get(value.op) === undefined) return null;
  const poll = app.operators.poll(value.op, SHARE_CONTEXT, value.args);
  return poll === true ? null : poll.reason;
}

/** A stable key of a call over the document as it is (a change of either prepares the file again). */
export function callKey(app: EditorApp, value: ShareCall): string {
  return `${value.op}:${JSON.stringify(value.args)}@${app.store.version}`;
}

/** Which Advanced options apply to a call (an option Pro's dialog does not offer for it is not shown). */
export function optionsFor(value: ShareCall | null): readonly (keyof ShareOptions)[] {
  if (value === null) return [];
  switch (value.op) {
    case 'file.export':
      return value.args['kind'] === 'bake-into-model'
        ? ['reduce', 'closeLoop', 'constantTracks', 'acknowledge']
        : ['reduce', 'closeLoop', 'constantTracks'];
    case 'file.exportCharacter':
      return ['material'];
    case 'file.exportModel':
      return ['colourOutput', 'material'];
    case 'autorig.export':
    case 'target.exportPackage':
      // Auto-Rig ⑤'s targets and C2's package take no options (their bytes are exactly Auto-Rig's)
      return [];
  }
}
