// M2A-SPEC §5.19 body parts (FR-KEY-10): a pure template-key table over humanoid auto-rigs (A0, complete). A
// control outside the table (eyes, secondary controls) belongs to the part of its nearest grouped ancestor; controls
// of generic rigs belong to none.
import type { ControlId, ControlRecord, ReadView } from '@ekza-animator/doc';
import type { BodyPart, EditorApp } from '../types';

/** Generator of humanoid auto-rigs (RigRecord.generator.name). */
const HUMANOID_GENERATOR = 'ekza-autorig-humanoid';

const CENTRE: Readonly<Record<string, BodyPart>> = {
  root: 'root',
  cog: 'torso',
  'fk.hips': 'torso',
  'fk.spine': 'torso',
  'fk.chest': 'torso',
  'fk.upperChest': 'torso',
  'fk.neck': 'head',
  'fk.head': 'head',
  'fk.jaw': 'head',
};

const ARM = new Set(['fk.shoulder', 'fk.upperArm', 'fk.lowerArm', 'fk.hand', 'ik.arm', 'pole.arm']);
const LEG = new Set(['fk.upperLeg', 'fk.lowerLeg', 'fk.foot', 'fk.toes', 'ik.leg', 'pole.leg']);
/** VRM finger bones: thumb (metacarpal, proximal, distal) and index/middle/ring/little (proximal…distal). */
const FINGER = /^fk\.(thumb|index|middle|ring|little)(Metacarpal|Proximal|Intermediate|Distal)$/;

/** The part of a humanoid template key, or null when the table does not list it. */
export function bodyPartOfTemplateKey(key: string): BodyPart | null {
  const centre = CENTRE[key];
  if (centre !== undefined) return centre;
  const match = /^(.+)\.(L|R)$/.exec(key);
  if (match === null) return null;
  const stem = match[1] as string;
  const side = match[2] as 'L' | 'R';
  if (ARM.has(stem)) return side === 'L' ? 'arm.L' : 'arm.R';
  if (LEG.has(stem)) return side === 'L' ? 'leg.L' : 'leg.R';
  if (FINGER.test(stem)) return side === 'L' ? 'fingers.L' : 'fingers.R';
  return null;
}

/** Whether the control's rig is a humanoid auto-rig (body parts exist only there). */
export function isHumanoidRigOf(view: ReadView, control: ControlRecord): boolean {
  return view.get('rigs', control.rig)?.generator.name === HUMANOID_GENERATOR;
}

/**
 * M2A-SPEC §5.19 (A0, complete): the body part of a control of a humanoid auto-rig — the template-key table, else
 * the part of its nearest ancestor in the table — or null (generic rigs, unknown controls, parts not reachable).
 */
export function bodyPartOf(app: EditorApp, control: ControlId): BodyPart | null {
  return bodyPartIn(app.store, control);
}

/** `bodyPartOf` over any read view (transactions included). */
export function bodyPartIn(view: ReadView, control: ControlId): BodyPart | null {
  let record = view.get('controls', control);
  if (record === undefined || !isHumanoidRigOf(view, record)) return null;
  const seen = new Set<ControlId>();
  while (record !== undefined && !seen.has(record.id)) {
    seen.add(record.id);
    const part = bodyPartOfTemplateKey(record.key);
    if (part !== null) return part;
    record = record.parent === null ? undefined : view.get('controls', record.parent);
  }
  return null;
}
