// rig_describe (MCP-SPEC §6.2, tool 5; P2). D0 lands the final schema with `ready: false`.
import { z } from 'zod';
import { bodyPartName, characterRef, detail, projectRef, vec3Out } from '../../schemas/common';
import { BUDGETS, defineTool } from '../define';

export const rigDescribe = defineTool({
  name: 'rig_describe',
  title: 'Describe a rig',
  description:
    "List a character's controls with keyable channels, rotate orders, limbs and IK/FK state, and which way each axis moves a bone.",
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
});
