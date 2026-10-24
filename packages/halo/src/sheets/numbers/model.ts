// Numbers, the model (STUDIO-TOUCH-SPEC §6.6, §10.1, §15 rows 3.1, 3.5, 3.21, 3.25, 7.2–7.5, 9.2; P14; T6b): the
// selected noun's full properties by section — the touch Channels, Attributes and Rig Toolkit fields together. Every
// value shows Studio Pro's number, unit and sign, with the Pro name in grey, and every edit is one operator run
// (`channel.setValues`, `scene.object.transform`, `mesh.pivot.set`, `mesh.primitive.set`, `mesh.setAttributes`,
// `imagePlane.set`, `view.camera.setSettings`, `skel.joint.setRest`, `clip.setSettings`, …). React-free: the sheet
// renders it, the unit tests drive it headless.
import { eulerToQuat, type ParamDef, quatToEuler, type ReadonlyXf } from '@ekza-studio/anim-core';
import type { ChannelId, ControlRecord } from '@ekza-studio/doc';
import {
  attrDefOf,
  channelDefaultOf,
  channelUnit,
  type EditorApp,
  fromDisplayValue,
  type OperatorId,
  TRS_CHANNEL_LABEL,
  toDisplayValue,
} from '@ekza-studio/editor-core';
import type { Noun } from '../../verbs/nouns';

export type NumbersSectionId =
  | 'transform'
  | 'pivot'
  | 'shapeInputs'
  | 'mesh'
  | 'character'
  | 'channels'
  | 'joint'
  | 'camera'
  | 'imagePlane'
  | 'animation';

export interface OperatorCall {
  readonly op: OperatorId;
  readonly args?: unknown;
}

export interface NumbersField {
  readonly id: string;
  /** The plain label (§1.3: Move, Turn, Scale; Numbers). */
  readonly label: string;
  /** The Pro name, in grey (§6.6). */
  readonly pro: string;
  readonly kind: 'number' | 'bool' | 'enum' | 'text' | 'readonly';
  /** Shown value: numbers in display units (degrees, metres); text for 'text' and 'readonly'. */
  readonly value: number | boolean | string;
  readonly unit?: string;
  readonly step?: number;
  readonly min?: number;
  readonly max?: number;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  /** The run that writes a new shown value (null: read-only). */
  readonly write: ((value: number | boolean | string) => OperatorCall) | null;
  /** Channel rows: locked, keyed here, and the row's menu (Key this channel, Lock / Unlock, Reset to default). */
  readonly locked?: boolean;
  readonly keyed?: boolean;
  readonly menu?: readonly (OperatorCall & { readonly label: string; readonly then?: OperatorCall })[];
}

export interface NumbersSection {
  readonly id: NumbersSectionId;
  readonly title: string;
  readonly fields: readonly NumbersField[];
  /** One-tap actions of the section (Pivot to centre, …; About this character ›). */
  readonly actions?: readonly (OperatorCall & { readonly label: string })[];
  /** Opens another sheet (About this character). */
  readonly link?: { readonly label: string; readonly sheet: 'about' };
}

const AXES = ['X', 'Y', 'Z'] as const;
const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

const TRS_PLAIN: Readonly<Record<string, string>> = {
  tx: 'Move X',
  ty: 'Move Y',
  tz: 'Move Z',
  rx: 'Turn X',
  ry: 'Turn Y',
  rz: 'Turn Z',
  sx: 'Scale X',
  sy: 'Scale Y',
  sz: 'Scale Z',
};

const round = (value: number, digits = 6): number => Number(value.toFixed(digits));

/** 'heelTwist' → 'Heel Twist' (the Channels panel's default attribute label). */
const titleCase = (name: string): string =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function get<T>(app: EditorApp, table: string, id: string | null): T | null {
  if (id === null) return null;
  const record = app.store.get(table as never, id as never) as (T & { readonly deleted?: unknown }) | undefined;
  return record === undefined || (record.deleted !== null && record.deleted !== undefined) ? null : record;
}

// ---------- channels (§6.6 Control; §10.1 same numbers as Pro) ----------

function axisFlag(axes: readonly [boolean, boolean, boolean], channel: string): boolean {
  const index = channel.endsWith('x') ? 0 : channel.endsWith('y') ? 1 : 2;
  return axes[index] === true;
}

/** The channels a control shows: its keyable TRS channels, then its attributes (`@name`). */
export function controlChannels(record: ControlRecord): readonly ChannelId[] {
  const out: ChannelId[] = [];
  for (const group of ['t', 'r', 's'] as const) {
    for (const axis of ['x', 'y', 'z'] as const) {
      const channel = `${group}${axis}` as ChannelId;
      if (axisFlag(record.keyable[group], channel)) out.push(channel);
    }
  }
  for (const name of Object.keys(record.attrs)) out.push(`@${name}` as ChannelId);
  return out;
}

function isLocked(record: ControlRecord, channel: ChannelId): boolean {
  if (channel.startsWith('@')) return false;
  const group = channel[0] as 't' | 'r' | 's';
  return axisFlag(record.locked[group], channel);
}

function channelsSection(app: EditorApp, ids: readonly string[]): NumbersSection | null {
  const lead = get<ControlRecord>(app, 'controls', ids.at(-1) ?? null);
  if (lead === null) return null;
  const selected = ids.map((id) => get<ControlRecord>(app, 'controls', id)).filter((c) => c !== null);
  const fields: NumbersField[] = [];
  for (const channel of controlChannels(lead)) {
    const unit = channelUnit(lead, channel);
    let stored = 0;
    try {
      stored = app.evaluation.channelValue(lead.id, channel);
    } catch {
      stored = channelDefaultOf(lead, channel);
    }
    let state = 'none';
    try {
      state = app.evaluation.channelState(lead.id, channel);
    } catch {
      state = 'none';
    }
    const def = attrDefOf(lead, channel);
    const targets = selected.filter((c) => controlChannels(c).includes(channel));
    const pro = channel.startsWith('@')
      ? (def?.label ?? titleCase(channel.slice(1)))
      : TRS_CHANNEL_LABEL[channel as never];
    const label = channel.startsWith('@')
      ? (def?.label ?? titleCase(channel.slice(1)))
      : (TRS_PLAIN[channel] ?? channel);
    const refs = targets.map((c) => ({ control: c.id, channel }));
    const shown = round(toDisplayValue(channel, stored, unit), 4);
    const write = (value: number | boolean | string): OperatorCall => ({
      op: 'channel.setValues',
      args: {
        edits: targets.map((c) => ({
          control: c.id,
          channel,
          value: fromDisplayValue(channel, Number(value), channelUnit(c, channel)),
        })),
        key: 'auto',
        label: `Set ${pro}`,
      },
    });
    const locked = isLocked(lead, channel);
    fields.push({
      id: `${lead.id}/${channel}`,
      label,
      pro: label === pro ? '' : String(pro),
      kind: def?.type === 'bool' ? 'bool' : 'number',
      value: def?.type === 'bool' ? stored >= 0.5 : shown,
      unit: unit === 'angle' ? '°' : unit === 'distance' ? ' m' : '',
      step: unit === 'angle' ? 1 : unit === 'distance' ? 0.01 : 0.01,
      ...(typeof def?.min === 'number' ? { min: def.min } : {}),
      ...(typeof def?.max === 'number' ? { max: def.max } : {}),
      write: locked ? null : (value) => (def?.type === 'bool' ? write(value === true ? 1 : 0) : write(value)),
      locked,
      keyed: state === 'keyed-on-frame',
      menu: [
        {
          label: 'Key this channel',
          op: 'select.channels',
          args: { refs, mode: 'replace' },
          then: { op: 'key.set', args: { channels: 'selected' } },
        },
        { label: locked ? 'Unlock' : 'Lock', op: 'channel.toggleLock', args: { refs, locked: !locked } },
        {
          label: 'Reset to default',
          op: 'channel.setValues',
          args: {
            edits: targets.map((c) => ({ control: c.id, channel, value: channelDefaultOf(c, channel) })),
            key: 'auto',
            label: `Reset ${pro}`,
          },
        },
      ],
    });
  }
  return { id: 'channels', title: selected.length > 1 ? `Channels · ${selected.length} parts` : 'Channels', fields };
}

// ---------- scene objects (§6.6 Transform, Pivot, Shape inputs, Mesh) ----------

interface ObjectLike {
  readonly id: string;
  readonly name: string;
  readonly placement: ReadonlyXf;
  readonly pivot: readonly [number, number, number];
  readonly faceted?: boolean;
  readonly generator?: {
    readonly kind: string;
    readonly params: Readonly<Record<string, number | boolean | string>>;
  } | null;
  readonly colourOutput?: string;
  readonly material?: unknown;
  readonly data?: unknown;
}

function objectOf(app: EditorApp, id: string | null): ObjectLike | null {
  return get<ObjectLike>(app, 'meshes', id) ?? get<ObjectLike>(app, 'groups', id);
}

function transformSection(app: EditorApp, object: ObjectLike): NumbersSection {
  const { t, q, s } = object.placement;
  const euler = quatToEuler(q, 'xyz');
  // Each write re-reads the placement, so two edits from one render never undo each other.
  const place = (axis: 't' | 'r' | 's', index: number, value: number): OperatorCall => {
    const now = objectOf(app, object.id)?.placement ?? object.placement;
    const nextT = axis === 't' ? now.t.map((v, j) => (j === index ? value : v)) : [...now.t];
    const nextS = axis === 's' ? now.s.map((v, j) => (j === index ? value : v)) : [...now.s];
    let rotation = now.q;
    if (axis === 'r') {
      const degrees = [...quatToEuler(now.q, 'xyz')].map((v, j) => (j === index ? value : v * RAD2DEG));
      rotation = eulerToQuat(degrees.map((d) => d * DEG2RAD) as never, 'xyz');
    }
    return {
      op: 'scene.object.transform',
      args: { ids: [object.id], placements: [{ t: nextT, q: [...rotation], s: nextS }] },
    };
  };
  const fields: NumbersField[] = [];
  AXES.forEach((axis, i) => {
    fields.push({
      id: `t${axis}`,
      label: `Move ${axis}`,
      pro: `Translate ${axis}`,
      kind: 'number',
      value: round(t[i] ?? 0, 4),
      unit: ' m',
      step: 0.01,
      write: (value) => place('t', i, Number(value)),
    });
  });
  const degrees = [...euler].map((v) => v * RAD2DEG);
  AXES.forEach((axis, i) => {
    fields.push({
      id: `r${axis}`,
      label: `Turn ${axis}`,
      pro: `Rotate ${axis}`,
      kind: 'number',
      value: round(degrees[i] ?? 0, 3),
      unit: '°',
      step: 1,
      write: (value) => place('r', i, Number(value)),
    });
  });
  AXES.forEach((axis, i) => {
    fields.push({
      id: `s${axis}`,
      label: `Scale ${axis}`,
      pro: `Scale ${axis}`,
      kind: 'number',
      value: round(s[i] ?? 1, 4),
      step: 0.01,
      write: (value) => place('s', i, Number(value)),
    });
  });
  return { id: 'transform', title: 'Transform', fields };
}

function pivotSection(app: EditorApp, object: ObjectLike): NumbersSection {
  const fields = AXES.map(
    (axis, i): NumbersField => ({
      id: `pivot${axis}`,
      label: `Pivot ${axis}`,
      pro: `Pivot ${axis}`,
      kind: 'number',
      value: round(object.pivot[i] ?? 0, 4),
      unit: ' m',
      step: 0.01,
      write: (value) => ({
        op: 'mesh.pivot.set',
        args: {
          id: object.id,
          pivot: (objectOf(app, object.id)?.pivot ?? object.pivot).map((v, j) => (j === i ? Number(value) : v)),
        },
      }),
    }),
  );
  const ids = [object.id];
  return {
    id: 'pivot',
    title: 'Pivot',
    fields,
    actions: [
      { label: 'Centre', op: 'mesh.pivot.center', args: { ids } },
      { label: 'Bottom', op: 'mesh.pivot.bottomCenter', args: { ids } },
      { label: 'Reset', op: 'mesh.pivot.reset', args: { ids } },
      { label: 'Bake', op: 'mesh.pivot.bake', args: { ids } },
    ],
  };
}

function paramField(param: ParamDef, value: unknown, write: (v: unknown) => OperatorCall): NumbersField {
  if (param.kind === 'bool') {
    return { id: param.name, label: param.label, pro: '', kind: 'bool', value: value === true, write: (v) => write(v) };
  }
  if (param.kind === 'enum' || param.kind === 'axis') {
    return {
      id: param.name,
      label: param.label,
      pro: '',
      kind: 'enum',
      value: String(value ?? param.default),
      options: param.options ?? [],
      write: (v) => write(v),
    };
  }
  const angle = param.kind === 'angle';
  const number = typeof value === 'number' ? value : typeof param.default === 'number' ? param.default : 0;
  return {
    id: param.name,
    label: param.label,
    pro: '',
    kind: 'number',
    value: round(angle ? number * RAD2DEG : number, 4),
    unit: angle ? '°' : param.kind === 'distance' ? ' m' : '',
    step: param.kind === 'int' || angle ? 1 : (param.step ?? 0.01),
    ...(param.min === undefined ? {} : { min: angle ? param.min * RAD2DEG : param.min }),
    ...(param.max === undefined ? {} : { max: angle ? param.max * RAD2DEG : param.max }),
    write: (v) => write(angle ? Number(v) * DEG2RAD : param.kind === 'int' ? Math.round(Number(v)) : Number(v)),
  };
}

function shapeInputsSection(app: EditorApp, object: ObjectLike): NumbersSection | null {
  const generator = object.generator ?? null;
  if (generator === null) return null;
  const def = app.operators.get(`mesh.create.${generator.kind}`);
  const params = (def?.params ?? []).filter((p) => p.hidden !== true && p.kind !== 'data');
  if (params.length === 0) return null;
  return {
    id: 'shapeInputs',
    title: 'Shape inputs',
    fields: params.map((param) =>
      paramField(param, generator.params[param.name], (value) => ({
        op: 'mesh.primitive.set',
        args: { mesh: object.id, params: { [param.name]: value } },
      })),
    ),
  };
}

const COLOUR_OUTPUT = [
  { value: 'palette-texture', label: 'Palette texture' },
  { value: 'vertex-colour', label: 'Point colours' },
  { value: 'material-per-colour', label: 'One material per colour' },
];

function meshSection(object: ObjectLike, isMesh: boolean): NumbersSection {
  const fields: NumbersField[] = [
    {
      id: 'name',
      label: 'Name',
      pro: 'Name',
      kind: 'text',
      value: object.name,
      write: (value) => ({ op: 'scene.rename', args: { id: object.id, name: String(value) } }),
    },
  ];
  if (isMesh) {
    fields.push({
      id: 'faceted',
      label: 'Hard edges everywhere',
      pro: 'Faceted',
      kind: 'bool',
      value: object.faceted === true,
      write: (value) => ({ op: 'mesh.setAttributes', args: { mesh: object.id, patch: { faceted: value === true } } }),
    });
    if (typeof object.colourOutput === 'string') {
      fields.push({
        id: 'colourOutput',
        label: 'Colours as',
        pro: 'Colour output',
        kind: 'enum',
        value: object.colourOutput,
        options: COLOUR_OUTPUT,
        write: (value) => ({
          op: 'mesh.setAttributes',
          args: { mesh: object.id, patch: { colourOutput: String(value) } },
        }),
      });
    }
  }
  return { id: 'mesh', title: isMesh ? 'Mesh' : 'Group', fields };
}

// ---------- image planes, cameras, joints, characters, animations ----------

interface PlaneLike {
  readonly id: string;
  readonly name: string;
  readonly camera: string;
  readonly offset: readonly [number, number];
  readonly size: number;
  readonly opacity: number;
  readonly depth: 'behind' | 'front';
  readonly locked: boolean;
  readonly visible: boolean;
}

function imagePlaneSection(plane: PlaneLike): NumbersSection {
  const set = (patch: Record<string, unknown>): OperatorCall => ({
    op: 'imagePlane.set',
    args: { id: plane.id, patch },
  });
  return {
    id: 'imagePlane',
    title: 'Reference',
    fields: [
      {
        id: 'name',
        label: 'Name',
        pro: 'Name',
        kind: 'text',
        value: plane.name,
        write: (v) => set({ name: String(v) }),
      },
      {
        id: 'opacity',
        label: 'Opacity',
        pro: 'Opacity',
        kind: 'number',
        value: round(plane.opacity * 100, 2),
        unit: '%',
        step: 1,
        min: 0,
        max: 100,
        write: (v) => set({ opacity: Number(v) / 100 }),
      },
      {
        id: 'size',
        label: 'Size',
        pro: 'Height',
        kind: 'number',
        value: round(plane.size, 4),
        unit: ' m',
        step: 0.01,
        min: 0.01,
        write: (v) => set({ size: Number(v) }),
      },
      ...(['Right', 'Up'] as const).map(
        (axis, i): NumbersField => ({
          id: `offset${axis}`,
          label: `Offset ${axis.toLowerCase()}`,
          pro: `Offset ${i === 0 ? 'X' : 'Y'}`,
          kind: 'number',
          value: round(plane.offset[i] ?? 0, 4),
          unit: ' m',
          step: 0.01,
          write: (v) => set({ offset: plane.offset.map((o, j) => (j === i ? Number(v) : o)) }),
        }),
      ),
      {
        id: 'depth',
        label: 'Depth',
        pro: 'Depth',
        kind: 'enum',
        value: plane.depth,
        options: [
          { value: 'behind', label: 'Behind the model' },
          { value: 'front', label: 'In front' },
        ],
        write: (v) => set({ depth: String(v) }),
      },
      {
        id: 'locked',
        label: 'Lock',
        pro: 'Locked',
        kind: 'bool',
        value: plane.locked,
        write: (v) => set({ locked: v }),
      },
      {
        id: 'visible',
        label: 'Show',
        pro: 'Visible',
        kind: 'bool',
        value: plane.visible,
        write: (v) => set({ visible: v }),
      },
      { id: 'camera', label: 'View', pro: 'Camera', kind: 'readonly', value: plane.camera, write: null },
    ],
  };
}

interface CameraLike {
  readonly id: string;
  readonly name: string;
  readonly projection: 'perspective' | 'orthographic';
  readonly fovY: number;
  readonly orthoHeight: number;
  readonly near: number;
  readonly far: number;
}

/** Focal length (mm, 35 mm full-frame) of a vertical field of view, and back. */
export const focalOf = (fovY: number): number => 12 / Math.tan(fovY / 2);
export const fovOf = (focal: number): number => 2 * Math.atan(12 / focal);

export function cameraSection(camera: CameraLike): NumbersSection {
  const set = (patch: Record<string, unknown>): OperatorCall => ({
    op: 'view.camera.setSettings',
    args: { camera: camera.id, ...patch },
  });
  return {
    id: 'camera',
    title: `Camera · ${camera.name}`,
    fields: [
      {
        id: 'fov',
        label: 'Lens angle',
        pro: 'Field of view',
        kind: 'number',
        value: round(camera.fovY * RAD2DEG, 2),
        unit: '°',
        step: 1,
        min: 1,
        max: 170,
        write: (v) => set({ fovY: Number(v) * DEG2RAD }),
      },
      {
        id: 'focal',
        label: 'Focal length',
        pro: 'Focal length',
        kind: 'number',
        value: round(focalOf(camera.fovY), 1),
        unit: ' mm',
        step: 1,
        min: 1,
        write: (v) => set({ fovY: fovOf(Number(v)) }),
      },
      {
        id: 'near',
        label: 'Near clip',
        pro: 'Near clip plane',
        kind: 'number',
        value: round(camera.near, 4),
        unit: ' m',
        step: 0.01,
        min: 0.0001,
        write: (v) => set({ near: Number(v) }),
      },
      {
        id: 'far',
        label: 'Far clip',
        pro: 'Far clip plane',
        kind: 'number',
        value: round(camera.far, 2),
        unit: ' m',
        step: 1,
        write: (v) => set({ far: Number(v) }),
      },
    ],
  };
}

interface JointLike {
  readonly id: string;
  readonly name: string;
  readonly humanBone: string | null;
  readonly restPosition: readonly [number, number, number];
}

function jointSection(joint: JointLike): NumbersSection {
  return {
    id: 'joint',
    title: 'Joint',
    fields: [
      {
        id: 'name',
        label: 'Name',
        pro: 'Name',
        kind: 'text',
        value: joint.name,
        write: (v) => ({ op: 'skel.joint.rename', args: { joint: joint.id, name: String(v) } }),
      },
      ...AXES.map(
        (axis, i): NumbersField => ({
          id: `rest${axis}`,
          label: `Rest ${axis}`,
          pro: `Rest translate ${axis}`,
          kind: 'number',
          value: round(joint.restPosition[i] ?? 0, 4),
          unit: ' m',
          step: 0.01,
          write: (v) => ({
            op: 'skel.joint.setRest',
            args: { joint: joint.id, position: joint.restPosition.map((p, j) => (j === i ? Number(v) : p)) },
          }),
        }),
      ),
      {
        id: 'humanBone',
        label: 'Humanoid bone',
        pro: 'Human bone',
        kind: 'readonly',
        value: joint.humanBone ?? 'None',
        write: null,
      },
    ],
  };
}

interface CharacterLike {
  readonly id: string;
  readonly name: string;
  readonly format: string;
  readonly source: { readonly kind: string };
  readonly vrm: { readonly licensePreset: string | null } | null;
}

const FORMAT_WORDS: Readonly<Record<string, string>> = { vrm0: 'VRM 0.x', vrm1: 'VRM 1.0', gltf: 'glTF' };

function characterSection(character: CharacterLike): NumbersSection {
  return {
    id: 'character',
    title: `Character · ${character.name}`,
    fields: [
      {
        id: 'format',
        label: 'Format',
        pro: 'Format',
        kind: 'readonly',
        value: FORMAT_WORDS[character.format] ?? character.format,
        write: null,
      },
      {
        id: 'source',
        label: 'Made from',
        pro: 'Source',
        kind: 'readonly',
        value: character.source.kind === 'model' ? 'A model in this project' : 'An imported file',
        write: null,
      },
      {
        id: 'licence',
        label: 'Licence and credits',
        pro: 'VRM Meta',
        kind: 'readonly',
        value: character.vrm?.licensePreset ?? 'Not chosen yet',
        write: null,
      },
    ],
    link: { label: 'About this character ›', sheet: 'about' },
  };
}

interface ClipLike {
  readonly id: string;
  readonly name: string;
  readonly fps: number;
  readonly range: { readonly start: number; readonly end: number };
  readonly loop: boolean;
}

function animationSection(clip: ClipLike): NumbersSection {
  const set = (patch: Record<string, unknown>): OperatorCall => ({
    op: 'clip.setSettings',
    args: { clip: clip.id, ...patch },
  });
  return {
    id: 'animation',
    title: `Animation · ${clip.name}`,
    fields: [
      {
        id: 'name',
        label: 'Name',
        pro: 'Clip name',
        kind: 'text',
        value: clip.name,
        write: (v) => ({ op: 'clip.rename', args: { clip: clip.id, name: String(v) } }),
      },
      {
        id: 'loop',
        label: 'Loops',
        pro: 'Loop',
        kind: 'bool',
        value: clip.loop,
        write: (v) => set({ loop: v === true }),
      },
      {
        id: 'start',
        label: 'Starts at frame',
        pro: 'Range start',
        kind: 'number',
        value: clip.range.start,
        step: 1,
        write: (v) => set({ range: { start: Math.round(Number(v)), end: clip.range.end } }),
      },
      {
        id: 'end',
        label: 'Ends at frame',
        pro: 'Range end',
        kind: 'number',
        value: clip.range.end,
        step: 1,
        write: (v) => set({ range: { start: clip.range.start, end: Math.round(Number(v)) } }),
      },
      { id: 'fps', label: 'Frames per second', pro: 'FPS', kind: 'readonly', value: String(clip.fps), write: null },
    ],
  };
}

function activeClip(app: EditorApp, character: string | null): ClipLike | null {
  if (character === null) return null;
  const id = app.session.getState().activeClip[character as never] ?? null;
  return get<ClipLike>(app, 'clips', id);
}

/** The sections Numbers shows for a noun (§6.6), in order. */
export function numbersSections(app: EditorApp, noun: Noun | null): readonly NumbersSection[] {
  const out: NumbersSection[] = [];
  const kind = noun?.kind ?? 'empty';
  const session = app.session.getState();
  if ((kind === 'control' || kind === 'foot') && noun !== null) {
    const channels = channelsSection(app, noun.ids);
    if (channels !== null) out.push(channels);
  }
  if (kind === 'mesh' && noun !== null) {
    const object = objectOf(app, noun.id);
    if (object !== null) {
      const isMesh = get(app, 'meshes', object.id) !== null;
      out.push(transformSection(app, object), pivotSection(app, object));
      const shape = shapeInputsSection(app, object);
      if (shape !== null) out.push(shape);
      out.push(meshSection(object, isMesh));
    }
  }
  if (kind === 'imagePlane' && noun !== null) {
    const plane = get<PlaneLike>(app, 'imagePlanes', noun.id);
    if (plane !== null) out.push(imagePlaneSection(plane));
  }
  if (kind === 'camera' && noun !== null) {
    const camera = get<CameraLike>(app, 'cameras', noun.id);
    if (camera !== null) out.push(cameraSection(camera));
  }
  if (kind === 'joint' && noun !== null) {
    const joint = get<JointLike>(app, 'joints', noun.id);
    if (joint !== null) out.push(jointSection(joint));
  }
  const characterId = noun?.character ?? session.activeCharacter;
  const character = get<CharacterLike>(app, 'characters', characterId);
  if (character !== null && (kind === 'character' || kind === 'control' || kind === 'foot' || kind === 'empty')) {
    out.push(characterSection(character));
  }
  if (session.workspace === 'animate') {
    const clip = activeClip(app, characterId);
    if (clip !== null) out.push(animationSection(clip));
  }
  return out;
}

/** The sheet title for a noun ("Numbers · Forearm R"). */
export function numbersTitle(noun: Noun | null): string {
  return noun === null || noun.kind === 'empty' ? 'Numbers' : `Numbers · ${noun.label}`;
}
