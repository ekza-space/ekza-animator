// What the Ask sheet remembers per project page (STUDIO-TOUCH-SPEC §14; T10): the requests sent to the AI agent (the
// History titles its group of steps with the request they answer) and the project as it was before the agent's first
// change of a pairing (*Restore the project as it was before the AI*). Session memory only, never the document.
import type { DocSnapshot } from '@ekza-studio/doc';
import type { AskRequest } from './model';

const requests = new WeakMap<object, AskRequest[]>();
const before = new WeakMap<object, { readonly snapshot: DocSnapshot; readonly at: number }>();

/** Remembers a request (the newest last). */
export function recordRequest(app: object, text: string, at = Date.now()): void {
  const list = requests.get(app) ?? [];
  const clean = text.trim();
  if (clean === '') return;
  if (list.at(-1)?.text === clean) return;
  list.push({ text: clean, at });
  requests.set(app, list);
}

export function requestsOf(app: object): readonly AskRequest[] {
  return requests.get(app) ?? [];
}

/** Keeps the project as it is now, as the state before the AI (a pairing's first Allow). */
export function keepBeforeAgent(app: object, snapshot: DocSnapshot): void {
  before.set(app, { snapshot, at: Date.now() });
}

export function beforeAgentOf(app: object): { readonly snapshot: DocSnapshot; readonly at: number } | null {
  return before.get(app) ?? null;
}
