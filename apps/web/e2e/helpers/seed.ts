// Seed helpers (MVP-SPEC §6.1): thin wrappers over `run()` that build a scenario's starting state from a fresh page.
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { call, runOk } from './test-api';

export type SampleId = 'seed-san' | 'polybot' | 'quaternius-ual';

const DEG = Math.PI / 180;

/** Loads a bundled sample through `file.loadSample` (the sample buttons' path) and returns the new character. */
export async function seedSample(
  page: Page,
  sample: SampleId,
  options?: Record<string, unknown>,
): Promise<{ readonly character: string; readonly clips: readonly string[] }> {
  const value = await runOk<{ character: string; clips: string[] }>(
    page,
    'file.loadSample',
    options === undefined ? { sample } : { sample, options },
  );
  expect(typeof value.character).toBe('string');
  return value;
}

/** The ControlId of a template key of the active character. */
export async function controlId(page: Page, key: string, character?: string): Promise<string> {
  const controls = character === undefined ? await call(page, 'controls') : await call(page, 'controls', character);
  const control = controls.find((candidate) => candidate.key === key);
  if (control === undefined) throw new Error(`No control '${key}' on the active character`);
  return control.id;
}

export interface WaveSeed {
  readonly character: string;
  readonly clip: string;
  /** ControlId of `fk.lowerArm.L`. */
  readonly control: string;
  /** CurveId of its `rz` curve (keys 30° / −30° / 30° at frames 0 / 15 / 30). */
  readonly rz: string;
}

/** The wave block used by many scenarios: clip `wave` with `fk.lowerArm.L` rz keyed 30°, −30°, 30° at 0, 15, 30. */
export async function seedWaveClip(page: Page, sample: SampleId = 'polybot'): Promise<WaveSeed> {
  const { character } = await seedSample(page, sample);
  const { clip } = await runOk<{ clip: string }>(page, 'clip.new', { name: 'wave' });
  const control = await controlId(page, 'fk.lowerArm.L', character);
  await runOk(page, 'select.controls', { ids: [control], mode: 'replace' });
  for (const [frame, degrees] of [
    [0, 30],
    [15, -30],
    [30, 30],
  ] as const) {
    await runOk(page, 'time.setFrame', { frame });
    await runOk(page, 'channel.setValues', { edits: [{ control, channel: 'rz', value: degrees * DEG }] });
    await runOk(page, 'key.set', { channels: 'rotate' });
  }
  await runOk(page, 'time.setFrame', { frame: 0 });
  const rz = (await call(page, 'curves', clip, control)).find((curve) => curve.channel === 'rz');
  expect(rz?.keys.map((key) => key.t)).toEqual([0, 15, 30]);
  return { character, clip, control, rz: rz?.id ?? '' };
}
