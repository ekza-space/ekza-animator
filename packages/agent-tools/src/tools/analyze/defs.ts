// Analysis tools (MCP-SPEC §6.7, tools 26–28; P4) and the stretch analyze_diff (S2). D0 lands the final schemas with
// `ready: false`. Result shapes mirror motion-analysis (§4.7).
import { z } from 'zod';
import {
  atLeastOne,
  bodyPartName,
  boneRef,
  CHECKPOINT_HANDLE,
  clipRef,
  controlRef,
  detail,
  frame,
  rangeFrames,
  scoped,
} from '../../schemas/common';
import { BUDGETS, defineTool } from '../define';

const span = z.tuple([z.number(), z.number()]);

export const contactReportOut = z.object({
  thresholds: z.object({ heightM: z.number(), speedMps: z.number(), scaledForHeightM: z.number() }),
  limbs: z.record(
    z.string(),
    z.object({
      contacts: z.array(span),
      slideCm: z.array(z.number()),
      maxSlideMps: z.number(),
      penetrationCm: z.number(),
    }),
  ),
  skatingRatio: z.number(),
  verdict: z.string(),
});
export const seamReportOut = z.object({
  verdict: z.enum(['seamless', 'pops', 'hitches', 'not_a_loop']),
  worstChannels: z.array(
    z.object({
      control: z.string(),
      channel: z.string(),
      c0: z.number(),
      c1PerFrame: z.number(),
      unit: z.enum(['deg', 'm', 'factor']),
    }),
  ),
  worstBones: z.array(
    z.object({ bone: z.string(), positionMm: z.number(), rotationDeg: z.number(), velocityMmPerFrame: z.number() }),
  ),
});
const oscillationOut = z.object({
  cycles: z.number(),
  periodFrames: z.number().nullable(),
  amplitude: z.number(),
  axis: z.tuple([z.number(), z.number(), z.number()]).nullable(),
});
const popsOut = z.object({
  pops: z.array(z.object({ bone: z.string(), frame: z.number(), degPerFrame: z.number() })),
  eulerFlips: z.array(z.object({ control: z.string(), channel: z.string(), frame: z.number(), jumpDeg: z.number() })),
});
const spacingOut = z.object({
  segments: z.array(
    z.object({ fromFrame: z.number(), toFrame: z.number(), kind: z.enum(['ease_in', 'ease_out', 'even', 'hold']) }),
  ),
  perFrameMm: z.array(z.number()).optional(),
});
const holdsOut = z.array(z.object({ fromFrame: z.number(), toFrame: z.number(), kind: z.enum(['dead', 'moving']) }));
const speedOut = z.object({ maxMps: z.number(), meanMps: z.number(), atFrame: z.number() });
const arcsOut = z.object({
  pathLengthM: z.number(),
  spikes: z.array(z.object({ frame: z.number(), turnDeg: z.number() })),
  smoothness: z.number(),
});

export const analyzeContacts = defineTool({
  name: 'analyze_contacts',
  title: 'Analyse foot contacts',
  description: 'Find foot contacts and measure foot sliding, skating and floor penetration.',
  group: 'analyze',
  input: z.strictObject({
    ...scoped,
    feet: z
      .array(z.enum(['L', 'R']))
      .min(1)
      .max(2)
      .optional()
      .describe('Feet to analyse (default both).'),
    hands: z.boolean().default(false).describe('Also find hand contacts.'),
    rangeFrames: rangeFrames().optional(),
    thresholds: z
      .strictObject({
        heightM: z.number().min(0.001).max(1).optional().describe('Contact height above the floor in metres.'),
        speedMps: z.number().min(0.001).max(10).optional().describe('Contact speed in metres per second.'),
      })
      .optional()
      .describe('Override the contact thresholds (they scale with the character height by default).'),
  }),
  output: contactReportOut,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.summary,
  example: { clip: 'walk' },
});

export const analyzeLoop = defineTool({
  name: 'analyze_loop',
  title: 'Analyse a loop seam',
  description: 'Check whether a looping clip is seamless and list the worst channels and bones at the seam.',
  group: 'analyze',
  input: z.strictObject({
    ...scoped,
    worst: z.int().min(1).max(20).default(5).describe('How many worst channels and bones to list (default 5).'),
  }),
  output: seamReportOut,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.summary,
  example: { clip: 'walk' },
});

export const analyzeMotion = defineTool({
  name: 'analyze_motion',
  title: 'Analyse motion',
  description:
    'Measure motion of bones or controls: oscillation cycles, pops and Euler flips, spacing, holds, speed, arcs.',
  group: 'analyze',
  input: z.strictObject({
    ...scoped,
    targets: z
      .strictObject({
        bones: z.array(boneRef).min(1).max(12).optional().describe('Bones (≤ 12).'),
        controls: z.array(controlRef).min(1).max(12).optional().describe('Controls (≤ 12).'),
        bodyParts: z.array(bodyPartName).min(1).max(10).optional().describe('Body parts.'),
      })
      .refine((value) => atLeastOne(['bones', 'controls', 'bodyParts'], value), 'pass bones, controls or bodyParts')
      .describe('What to measure: ≤ 12 resolved targets.'),
    metrics: z
      .array(z.enum(['oscillation', 'pops', 'spacing', 'holds', 'speed', 'arcs']))
      .min(1)
      .max(6)
      .describe('Metrics to compute.'),
    rangeFrames: rangeFrames().optional(),
    relativeTo: boneRef.optional().describe('Measure positions relative to this bone (e.g. the chest).'),
    detail,
  }),
  output: z.object({
    targets: z.record(
      z.string(),
      z.object({
        oscillation: oscillationOut.optional(),
        pops: popsOut.optional(),
        spacing: spacingOut.optional(),
        holds: holdsOut.optional(),
        speed: speedOut.optional(),
        arcs: arcsOut.optional(),
      }),
    ),
  }),
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.read,
  example: { clip: 'wave', targets: { bones: ['leftHand'] }, metrics: ['oscillation'] },
});

export const analyzeDiff = defineTool({
  name: 'analyze_diff',
  title: 'Compare animation',
  description: 'Compare the animation now with a checkpoint, another clip or another frame, per body part.',
  group: 'analyze',
  input: z.strictObject({
    ...scoped,
    against: z
      .union([
        z.strictObject({ checkpoint: z.string().regex(CHECKPOINT_HANDLE).describe('A checkpoint (cp_…).') }),
        z.strictObject({ clip: clipRef }),
        z.strictObject({
          frame: frame('Compare this clip frame …'),
          atFrame: frame('… with this clip frame.'),
        }),
      ])
      .describe('What to compare with: a checkpoint, another clip, or another frame.'),
    rangeFrames: rangeFrames().optional(),
  }),
  output: z.object({
    bodyParts: z.record(z.string(), z.object({ rmsDeg: z.number(), maxDeg: z.number(), maxCm: z.number() })),
  }),
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: true,
  kind: 'read',
  budget: BUDGETS.read,
  example: { clip: 'walk', against: { checkpoint: 'cp_0123456789ab' } },
});
