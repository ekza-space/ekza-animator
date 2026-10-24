// Provenance helpers for the editor side (G-d): the gateway computes the record (hashes, pinned model, terms
// snapshot); the editor adds the prompt text only on the user's opt-in (Q-GEN-5) and appends post steps as they run.
import { promptSha256 } from './hash.ts';
import type { GenProvenance } from './types.ts';

/** Returns the record with the prompt text set, after checking it is the text the job was generated from. */
export async function withPromptOptIn(p: GenProvenance, prompt: string): Promise<GenProvenance> {
  if (p.promptSha256 === null) throw new Error('This generation had no prompt.');
  if ((await promptSha256(prompt)) !== p.promptSha256) throw new Error('The prompt does not match the generation.');
  return { ...p, prompt };
}

/** Appends a post-chain step; reduce and palette bake can alter invisible AI marks (ADR 0017 §7). */
export function withPostStep(p: GenProvenance, op: string, aiMarksMayBeAltered: boolean): GenProvenance {
  return { ...p, postSteps: [...p.postSteps, { op, aiMarksMayBeAltered }] };
}

/** The post steps that may alter a provider's invisible AI marks. */
export const MARK_ALTERING_STEPS: readonly string[] = ['mesh.reduce', 'mesh.paletteBake', 'mesh.textureDownsize'];
