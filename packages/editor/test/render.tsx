// Minimal React rendering helpers for Vitest browser mode (no testing-library dependency).
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { commands } from 'vitest/browser';

declare global {
  // React reads this flag to allow act() outside a test renderer.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  readonly container: HTMLElement;
  rerender(node: ReactNode): Promise<void>;
  unmount(): Promise<void>;
}

export async function render(node: ReactNode): Promise<Rendered> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    container,
    rerender: (next) => act(async () => root.render(next)),
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

/** Runs `fn` inside act() so React flushes the resulting renders. */
export function update(fn: () => void): Promise<void> {
  return act(async () => fn());
}

export function byTestId(container: ParentNode, id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (element === null) throw new Error(`no element with data-testid="${id}"`);
  return element;
}

/** A synthetic fixture read through Vitest's browser commands (paths resolve from the package root). */
export async function readSynthetic(name: 'wave-doc.json' | 'humanoid-skeleton.json'): Promise<unknown> {
  return JSON.parse(await commands.readFile(`../../fixtures/synthetic/${name}`)) as unknown;
}
