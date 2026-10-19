// scene_summary (MCP-SPEC §6.2 tool 4, §5.7): characters and clips, what the host can do and, with a user session,
// the user's state — active character and clip, frame, playing, the time-slider band, selected controls, selected keys
// and channels, the number of unkeyed overrides — so the agent can act on "the arm I selected" by passing those
// targets explicitly. Also the payload of the project resources (summary, selection, time; §5.20.3).
import type { CharacterId, CharacterRecord, ClipId, ControlId, CurveId } from '@ekza-animator/doc';
import type { EditorApp, HistoryStep, RunActor } from '@ekza-animator/editor-core';
import { readVrmLicense } from '@ekza-animator/io';
import { LIMB_IDS } from '@ekza-animator/rig';
import { controlKeyOf } from '../../resolve/resolver';
import { overridesOn } from '../../units/pose';
import { fpsNumber, outFrame, roundTo } from '../../units/units';
import { AGENT_TOOLSET_VERSION, type AgentHost, type Grants } from '../../types';

type RunActorLike = Pick<RunActor, 'id'>;

/** At most this many selected controls and selected keys are listed (§5.7). */
export const SELECTED_CONTROLS_MAX = 50;
export const SELECTED_KEYS_MAX = 200;
/** Steps listed in `history` (the last three). */
const HISTORY_ROWS = 3;

export type ActorKind = 'this_agent' | 'other_agent' | 'user';

/** Whose step this is, seen from `actor` (§5.6). */
export function actorKindOf(step: Pick<HistoryStep, 'actor'>, actor: RunActorLike): ActorKind {
  if (step.actor === undefined || step.actor === null) return 'user';
  return step.actor.id === actor.id ? 'this_agent' : 'other_agent';
}

function limbModeOf(ikFk: number): 'ik' | 'fk' | 'blend' {
  if (ikFk >= 1 - 1e-6) return 'ik';
  if (ikFk <= 1e-6) return 'fk';
  return 'blend';
}

/** IK/FK mode per limb at the character's current frame (what the user sees). */
export function limbModes(app: EditorApp, character: CharacterId): Record<string, 'ik' | 'fk' | 'blend'> {
  const out: Record<string, 'ik' | 'fk' | 'blend'> = {};
  for (const limb of LIMB_IDS) {
    const value = app.evaluation.ikFk(character, limb);
    if (value !== null) out[limb] = limbModeOf(value);
  }
  return out;
}

function formatOf(record: CharacterRecord): 'vrm0' | 'vrm1' | 'glb' {
  return record.format === 'gltf' ? 'glb' : record.format;
}

function metaOf(app: EditorApp, character: CharacterId) {
  const runtime = app.characters.get(character);
  const license = runtime === undefined ? null : readVrmLicense(runtime.container);
  if (license === null) return { title: '', author: '', license: 'unknown', allowRedistribution: 'unknown' };
  return {
    title: license.title ?? '',
    author: license.authors.join(', '),
    license: license.licenseName ?? license.licenseUrl ?? 'unknown',
    allowRedistribution: license.allowRedistribution === null ? 'unknown' : license.allowRedistribution ? 'yes' : 'no',
  };
}

/** The user's selection with selected keys (§5.7): template keys, `[{control, channel, frames}]`, channels. */
export function userSelectionOf(app: EditorApp): {
  readonly controls: string[];
  readonly keys: { control: string; channel: string; frames: number[] }[];
  readonly keyCount: number;
  readonly truncated: boolean;
  readonly channels: string[];
} {
  const { selection } = app.session.getState();
  const keyOf = (control: ControlId): string => {
    const record = app.store.get('controls', control);
    return record === undefined ? control : controlKeyOf(record);
  };
  const controls = selection.controls.slice(0, SELECTED_CONTROLS_MAX).map(keyOf);
  const byCurve = new Map<CurveId, number[]>();
  let keyCount = 0;
  let listed = 0;
  for (const keyId of selection.keys.keys()) {
    const key = app.store.get('keys', keyId);
    if (key === undefined) continue;
    keyCount++;
    if (listed >= SELECTED_KEYS_MAX) continue;
    listed++;
    let frames = byCurve.get(key.curve);
    if (frames === undefined) {
      frames = [];
      byCurve.set(key.curve, frames);
    }
    frames.push(outFrame(key.t));
  }
  const keys: { control: string; channel: string; frames: number[] }[] = [];
  for (const [curveId, frames] of byCurve) {
    const curve = app.store.get('curves', curveId);
    if (curve === undefined) continue;
    keys.push({ control: keyOf(curve.control), channel: curve.channel, frames: frames.sort((a, b) => a - b) });
  }
  const channels = selection.channels.map((ref) => `${keyOf(ref.control)} ${ref.channel}`);
  return {
    controls,
    keys,
    keyCount,
    truncated: keyCount > listed || selection.controls.length > SELECTED_CONTROLS_MAX,
    channels,
  };
}

/** The user's time (§5.20.3 `time`): clip, clip frame, playing, playback range, band. */
export function userTimeOf(app: EditorApp): {
  readonly character: string | null;
  readonly clip: string | null;
  readonly frame: number | null;
  readonly playing: boolean;
  readonly playbackRange: [number, number] | null;
  readonly band: [number, number] | null;
} {
  const state = app.session.getState();
  const character = state.activeCharacter;
  const clipId: ClipId | undefined = character === null ? undefined : state.activeClip[character];
  const clip = clipId === undefined ? undefined : app.store.get('clips', clipId);
  const frame = character === null ? null : app.evaluation.clipFrame(character);
  const range = state.time.playbackRange;
  const offset = clip === undefined ? 0 : clip.sceneStart;
  return {
    character: character === null ? null : (app.store.get('characters', character)?.name ?? null),
    clip: clip?.name ?? null,
    frame: frame === null ? null : outFrame(frame),
    playing: state.time.playing,
    // the playback range is in scene frames; the clip shows it from its scene start
    playbackRange: range === null ? null : [outFrame(range.start - offset), outFrame(range.end - offset)],
    band: state.time.band === null ? null : [outFrame(state.time.band.start), outFrame(state.time.band.end)],
  };
}

export interface SummaryHost {
  readonly host: AgentHost;
  readonly actor: RunActorLike;
  readonly revision: (clip: ClipId) => number;
  /** Marks clips as seen when the summary lists them. */
  readonly markSeen?: (clip: ClipId) => void;
}

/** The data of scene_summary (§6.2). */
export function sceneSummaryData(app: EditorApp, env: SummaryHost, detail: 'concise' | 'detailed') {
  const { host, actor } = env;
  const state = app.session.getState();
  const characters = [...app.store.list('characters')].sort((a, b) =>
    a.order < b.order ? -1 : a.order > b.order ? 1 : 0,
  );
  const fidelity: ('shaded' | 'schematic')[] = [];
  if (host.capabilities.has('capture.shaded')) fidelity.push('shaded');
  if (host.capabilities.has('capture.schematic')) fidelity.push('schematic');
  const files: ('download' | 'workspace')[] = [];
  if (host.capabilities.has('files.download')) files.push('download');
  if (host.capabilities.has('files.workspace')) files.push('workspace');
  const grants: Grants = host.grants();
  const history = app.history.entries().undo.slice(-HISTORY_ROWS).reverse();
  const userSession = host.capabilities.has('user');
  const activeCharacter = state.activeCharacter;
  const activeClipId: ClipId | undefined = activeCharacter === null ? undefined : state.activeClip[activeCharacter];
  return {
    host: {
      mode: host.mode,
      fidelity,
      files,
      grants: { ...grants, read: true as const },
      paused: host.paused(),
      toolset: AGENT_TOOLSET_VERSION,
      previewActive: app.store.preview?.active === true,
    },
    project: {
      name: state.projectName,
      dirty: state.dirty,
      readOnly: app.store.readOnly,
      docVersion: app.store.version,
    },
    characters: characters.map((record) => {
      const runtime = app.characters.get(record.id);
      const rig = app.store.query.rigOfCharacter(record.id);
      const clips = app.store.query.clipsOfCharacter(record.id).map((clip) => {
        let keyCount = 0;
        for (const curve of app.store.query.curvesOfClip(clip.id)) {
          keyCount += app.store.query.keysOfCurve(curve.id).length;
        }
        env.markSeen?.(clip.id);
        return {
          name: clip.name,
          id: clip.id,
          fps: fpsNumber(clip.fps),
          rangeFrames: [clip.range.start, clip.range.end] as [number, number],
          loop: clip.loop,
          keyCount,
          revision: env.revision(clip.id),
          active: state.activeClip[record.id] === clip.id,
        };
      });
      return {
        name: record.name,
        id: record.id,
        format: formatOf(record),
        humanoid: rig?.generator.name === 'ekza-autorig-humanoid',
        heightM: runtime === undefined ? 0 : roundTo(runtime.skeleton.height, 0.0001),
        limbs: limbModes(app, record.id),
        clips,
        ...(detail === 'detailed' ? { meta: metaOf(app, record.id) } : {}),
      };
    }),
    ...(userSession
      ? {
          user: {
            activeCharacter:
              activeCharacter === null ? null : (app.store.get('characters', activeCharacter)?.name ?? null),
            activeClip: activeClipId === undefined ? null : (app.store.get('clips', activeClipId)?.name ?? null),
            frame:
              activeCharacter === null
                ? null
                : ((frame) => (frame === null ? null : outFrame(frame)))(app.evaluation.clipFrame(activeCharacter)),
            playing: state.time.playing,
            band:
              state.time.band === null
                ? null
                : ([outFrame(state.time.band.start), outFrame(state.time.band.end)] as [number, number]),
            selection: userSelectionOf(app),
            overrides: activeCharacter === null ? 0 : overridesOn(app, activeCharacter),
          },
        }
      : {}),
    history: history.map((step) => ({ step: step.id, label: step.label, actor: actorKindOf(step, actor) })),
  };
}
