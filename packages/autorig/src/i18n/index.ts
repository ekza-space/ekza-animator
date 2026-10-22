// Auto-Rig strings (AUTORIG-SPEC §8.4; D0, closed): every user-visible string of the wizard lives in a typed message
// table, split per step owner (`en/<step>.ts`); components never inline text. No runtime library: a value is a string
// or a function of its arguments, numbers and units go through `Intl.NumberFormat`. v1 ships English; `ru` / `zh` are a
// new table plus the language pick (Q-AR-9).
import { en } from './en';

/** One owner's table: keys to strings or to functions that build a string from their arguments. */
export type MessageTable = Readonly<Record<string, string | ((...args: never[]) => string)>>;

/** The shape every language's table has (the English one's). */
export type Messages = typeof en;
export type MessageSection = keyof Messages;

/** The languages Auto-Rig ships (§8.4). */
export type AutoRigLanguage = 'en';

const TABLES: Readonly<Record<AutoRigLanguage, Messages>> = { en };

/** The message table of a language (v1: English only). */
export function messages(language: AutoRigLanguage = 'en'): Messages {
  return TABLES[language];
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
