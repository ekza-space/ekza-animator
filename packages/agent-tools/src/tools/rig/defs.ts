// rig_describe (MCP-SPEC §6.2, tool 5; P2).
import { z } from 'zod';
import { bodyPartName, characterRef, detail, projectRef, vec3Out } from '../../schemas/common';
import { BUDGETS, defineTool } from '../define';
import { describeRig } from './describe';

export const rigDescribe = defineTool({
  name: 'rig_describe',
  title: 'Describe a rig',
  description:
    "List a character's controls with keyable channels, rotate orders, limbs and IK/FK state, and which way each axis moves a bone. " +
    'Call it once per character before posing. Each control has its template key (fk.upperArm.L, ik.leg.R, cog — ' +
    'pass it back as is), display name, VRM bone, side (L = the character’s left), body part, keyable and locked ' +
    'channels (tx ty tz metres, rx ry rz degrees, sx sy sz factor, @attributes), rotate order and mirror control. ' +
    'Limbs list their IK/FK mode (legs are IK by default, arms FK), ikFk value, IK control, pole and FK chain. ' +
    'concise (default) lists the primary controls, counts secondary and finger controls per body part and the ' +
    'controls a limb’s mode hides (FK in IK) in `secondary`, and leaves attribute details out (their @channels are ' +
    'listed); pass bodyParts (e.g. ["fingers.L"]) to list a part completely. detailed adds axisHints — how the ' +
    "driven bone's tip moves for +10° on each rotation channel at rest ('rz': 'tip up 4.1 cm, forward 0.4 cm') — and " +
    'each bone’s rest direction in character space (+Y up, +Z forward, +X the character’s left).',
  group: 'scene',
  input: z.strictObject({
    project: projectRef.optional(),
    character: characterRef.optional(),
    bodyParts: z
      .array(bodyPartName)
      .min(1)
      .max(10)
      .optional()
      .describe('Only these body parts (lists secondary controls too).'),
    detail,
  }),
  output: z.object({
    character: z.string(),
    rig: z.enum(['humanoid', 'generic']),
    secondary: z.array(z.object({ group: z.string(), count: z.number() })),
    controls: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        bone: z.string().nullable(),
        side: z.enum(['L', 'R', 'C']),
        bodyPart: z.string(),
        channels: z.array(z.string()),
        locked: z.array(z.string()),
        rotateOrder: z.string(),
        mirror: z.string().nullable(),
        attrs: z.array(
          z.object({
            name: z.string(),
            unit: z.enum(['deg', 'm', 'none']),
            min: z.number().optional(),
            max: z.number().optional(),
            default: z.number(),
          }),
        ),
        axisHints: z.record(z.string(), z.string()).optional(),
        restDirection: vec3Out.optional(),
      }),
    ),
    limbs: z.array(
      z.object({
        limb: z.string(),
        mode: z.enum(['ik', 'fk', 'blend']),
        ikFk: z.number(),
        ikControl: z.string(),
        pole: z.string(),
        fk: z.array(z.string()),
      }),
    ),
  }),
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: true,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.read,
  example: { detail: 'concise' },
  ready: true,
  run(ctx, args) {
    const character = ctx.resolve.character(args.character);
    const data = describeRig(ctx.app, character.id, { bodyParts: args.bodyParts, detail: args.detail });
    return Promise.resolve({
      ok: true,
      data,
      ...(data.secondary.length > 0 && args.bodyParts === undefined && args.detail === 'concise'
        ? { next: 'Secondary and finger controls are counted in `secondary`: pass bodyParts to list them.' }
        : {}),
    });
  },
});
