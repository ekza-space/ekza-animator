// Auto-Rig strings (AUTORIG-SPEC §8.4; D0, closed): every user-visible string of the wizard lives in a typed message
// table, split per step owner (`en/<step>.ts`); components never inline text. No runtime library: a value is a string
// or a function of its arguments, numbers and units go through `Intl.NumberFormat`. v1 ships English; `ru` / `zh` are a
// new table plus the language pick (Q-AR-9).
import { type EnMessages, en } from './en';

/** One owner's table: keys to strings or to functions that build a string from their arguments. */
export type MessageTable = Readonly<Record<string, string | ((...args: never[]) => string)>>;

/** The shape every language's table has (the English one's). */
export type Messages = EnMessages;
export type MessageSection = keyof Messages;

/** The sections that load with their step's chunks (D7 AR-D7-2): `steps/<step>/strings.ts` registers each. */
export type LazyMessageSection = Exclude<MessageSection, 'frame' | 'model'>;

/** The languages Auto-Rig ships (§8.4). */
export type AutoRigLanguage = 'en';

const TABLES: Readonly<Record<AutoRigLanguage, Partial<Messages>>> = { en: { ...en } };

/**
 * Registers a step's table (its `strings.ts`, imported by every module of the step that reads it, so the table is
 * there before any of them runs). Idempotent.
 */
export function registerMessages<S extends LazyMessageSection>(
  section: S,
  table: Messages[S],
  language: AutoRigLanguage = 'en',
): void {
  (TABLES[language] as Record<string, unknown>)[section] = table;
}

/** The message table of a language (v1: English only); a step's section is there once its step code has loaded. */
export function messages(language: AutoRigLanguage = 'en'): Messages {
  return TABLES[language] as Messages;
}

/** A number in the table's language (`maximumFractionDigits` default 1). */
export function formatNumber(
  value: number,
  opts: Intl.NumberFormatOptions = {},
  language: AutoRigLanguage = 'en',
): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1, ...opts }).format(value);
}

export { en };
