// The shared wave script (MCP-SPEC §9.1 E2E-AI-01 step 5, AE-01's reference, MVP-AC-1): one labelled checkpoint, a
// new 2-second clip, then seven pose_aim calls alternating the forearm every 10 frames — three waves of the left hand
// above the shoulder.
import type { Agent } from '../drivers/scripted';

export interface WaveOptions {
  readonly project?: string;
  readonly clip?: string;
  /** Forearm swings: 6 make three waves; fewer make fewer (the adversarial "two waves"). */
  readonly swings?: number;
}

export async function waveScript(agent: Agent, opts: WaveOptions = {}): Promise<void> {
  const project = opts.project === undefined ? {} : { project: opts.project };
  const clip = opts.clip ?? 'wave';
  const swings = opts.swings ?? 6;
  await agent.ok('scene_summary', { ...project });
  await agent.ok('history_checkpoint', { ...project, label: 'Wave left hand ×3' });
  await agent.ok('clip_create', { ...project, name: clip, fps: 30, durationSeconds: 2 });
  for (let i = 0; i <= swings; i++) {
    await agent.ok('pose_aim', {
      ...project,
      clip,
      frame: Math.round((60 / swings) * i),
      aims: [
        { bone: 'leftUpperArm', direction: [0.8, 0.6, 0] },
        { bone: 'leftLowerArm', direction: i % 2 === 0 ? [0.55, 0.83, 0.1] : [-0.25, 0.97, 0.1] },
      ],
      intent: 'Wave',
    });
  }
}
