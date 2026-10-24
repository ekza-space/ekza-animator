// Home's model (STUDIO-TOUCH-SPEC §4.2 A, §17, §9 J10; T11): pure data over the app — the Continue cards from the
// orphaned autosave slots (newest first), which door is the primary one (*Try a sample* with no Continue cards, §4.2),
// the samples and the three starts of *Make a character*, and the plain "2 min ago" words. No React.
import type { AutosaveSlotInfo, EditorApp } from '@ekza-studio/editor-core';
import { en } from '../i18n/en';

/** "just now", "2 min ago", "3 hours ago", "yesterday", "4 days ago". */
export function agoText(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return en.ago.now;
  if (minutes < 60) return en.ago.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return en.ago.hours(hours);
  return en.ago.days(Math.floor(hours / 24));
}

export interface ContinueCard {
  readonly slot: string;
  readonly name: string;
  readonly detail: string;
  readonly savedAt: number;
}

/** The Continue row (§17): every orphaned slot, newest first. */
export function continueCards(recovery: readonly AutosaveSlotInfo[], now: number): readonly ContinueCard[] {
  return [...recovery]
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((slot) => ({
      slot: slot.id,
      name: slot.projectName.trim() === '' ? 'Untitled' : slot.projectName,
      detail: en.home.continueDetail(agoText(slot.savedAt, now), en.home.contents(slot.characters, slot.clips)),
      savedAt: slot.savedAt,
    }));
}

/** §4.2 A: *Try a sample* is the filled door when there is nothing to continue (a new user may have no model file). */
export function primaryDoor(cards: readonly ContinueCard[]): 'sample' | 'continue' {
  return cards.length === 0 ? 'sample' : 'continue';
}

/** The samples of *Try a sample ▾*: the rigged ones load as characters (`file.loadSample`), the Cube Lad as a model to
 *  rig (`autorig.sample`, the shared intake). */
export type SampleChoice = 'polybot' | 'seed-san' | 'cube-lad';
export const SAMPLE_CHOICES: readonly SampleChoice[] = ['polybot', 'seed-san', 'cube-lad'];

export interface SampleCall {
  readonly op: 'file.loadSample' | 'autorig.sample';
  readonly args: { readonly sample: SampleChoice };
}

export function sampleCall(sample: SampleChoice): SampleCall {
  return sample === 'cube-lad'
    ? { op: 'autorig.sample', args: { sample } }
    : { op: 'file.loadSample', args: { sample } };
}

/** *Make a character*'s three starts (§9 J2 step 1). */
export type StartChoice = 'smooth' | 'blocky' | 'cubeLad';
export const START_CHOICES: readonly StartChoice[] = ['smooth', 'blocky', 'cubeLad'];

/** The template run of a start (the Cube Lad is the sample's intake instead). */
export function startCall(start: StartChoice): { readonly op: 'mesh.create.template'; readonly args: unknown } | null {
  switch (start) {
    case 'smooth':
      return { op: 'mesh.create.template', args: { template: 'humanoidBody', style: 'smooth' } };
    case 'blocky':
      return { op: 'mesh.create.template', args: { template: 'humanoidBody', style: 'segmented' } };
    case 'cubeLad':
      return null;
  }
}

export const documentEmpty = (app: EditorApp): boolean =>
  app.store.list('characters').length === 0 && app.store.list('meshes').length === 0;
