// Set-up of the Timeline panel tests: the panel over the fake app with the synthetic wave document.
import type { ClipId, ClipRecord, DocSnapshot } from '@ekza-animator/doc';
import type { OperatorDef, SessionState } from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import { act } from 'react';
import { EditorAppProvider } from '../../../src';
import { TimelinePanel } from '../../../src/panels/timeline/TimelinePanel';
import { byTestId, type Rendered, readSynthetic, render } from '../../render';

export const WAVE_CLIP = 'clp_SyntheticWave001' as ClipId;

let snapshot: string | null = null;

export async function waveApp(): Promise<FakeEditorApp> {
  snapshot ??= JSON.stringify(await readSynthetic('wave-doc.json'));
  return createFakeEditorApp({ snapshot: JSON.parse(snapshot) as DocSnapshot });
}

export interface PanelView extends Rendered {
  readonly app: FakeEditorApp;
  get(testId: string): HTMLElement;
  query(testId: string): HTMLElement | null;
}

/** Renders the Timeline panel in a 1200×58 px box. */
export async function renderPanel(app: FakeEditorApp, width = 1200): Promise<PanelView> {
  const view = await render(
    <EditorAppProvider app={app}>
      <div style={{ width, height: 58 }}>
        <TimelinePanel app={app} instanceId="timeline#1" />
      </div>
    </EditorAppProvider>,
  );
  await frames(2); // ResizeObserver delivers the canvas size
  return {
    ...view,
    app,
    // Menus and dialogs render in portals on document.body.
    get: (testId) => byTestId(view.container.ownerDocument, testId),
    query: (testId) => view.container.ownerDocument.querySelector<HTMLElement>(`[data-testid="${testId}"]`),
  };
}

/** Waits for `n` animation frames inside act() so effects and observers settle. */
export async function frames(n = 1): Promise<void> {
  await act(async () => {
    for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

export function setTime(app: FakeEditorApp, patch: Partial<SessionState['time']>): void {
  act(() => app.session.setState({ time: { ...app.session.getState().time, ...patch } }));
}

export function patchClip(app: FakeEditorApp, fields: Partial<Omit<ClipRecord, 'id'>>): void {
  act(() => {
    app.store.transact({ label: 'Clip Settings' }, (tx) => tx.patch('clips', WAVE_CLIP, fields));
  });
}

/** Registers a test operator that records nothing itself (the fake app records every run in `calls`). */
export function stubOperator(app: FakeEditorApp, id: `${string}.${string}`, poll = true): void {
  const def: OperatorDef<unknown, unknown> = {
    id,
    label: id,
    category: 'test',
    scope: 'global',
    poll: () => (poll ? true : { ok: false, reason: 'test' }),
    apply: () => undefined,
  };
  app.contribute({ kind: 'operator', def });
}

export function callsOf(app: FakeEditorApp, id: string): unknown[] {
  return app.calls.filter((call) => call.id === id).map((call) => call.args);
}

/** Dispatches a pointer event of `type` at viewport point (x, y) on `target`. */
export function pointerAt(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
  init: PointerEventInit = {},
): void {
  const pressed = type === 'pointerup' ? 0 : 1;
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 7,
        pointerType: 'mouse',
        clientX: x,
        clientY: y,
        button: type === 'pointermove' ? -1 : 0,
        buttons: pressed,
        ...init,
      }),
    );
  });
}

/** Lets operators started by the panel finish (`app.run` is asynchronous). */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Sets an input's value the way typing does (React sees the change). */
export async function typeInto(input: HTMLElement, text: string): Promise<void> {
  if (!(input instanceof HTMLInputElement)) throw new Error('not an input');
  await act(async () => {
    input.focus();
    // React tracks the value through the prototype's setter; an own-property write would not reach it.
    Reflect.set(HTMLInputElement.prototype, 'value', text, input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Types `text` and presses Enter (the fields commit on Enter). */
export async function typeAndEnter(input: HTMLElement, text: string): Promise<void> {
  await typeInto(input, text);
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  await settle();
}

export async function chooseOption(select: HTMLElement, value: string): Promise<void> {
  if (!(select instanceof HTMLSelectElement)) throw new Error('not a select');
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

export async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
  await settle();
}
