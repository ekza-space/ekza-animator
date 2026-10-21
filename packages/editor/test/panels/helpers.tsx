// Shared helpers of the WP-9 data-panel tests: the fake app over the synthetic wave document (shared test kit,
// MVP-SPEC §3 convention 12), record builders written through the store, and act()-wrapped real input events.
import type {
  CameraId,
  CharacterId,
  CameraRecord,
  ClipId,
  ClipRecord,
  ControlId,
  ControlRecord,
  DocSnapshot,
} from '@ekza-studio/doc';
import type { EditorApp, OperatorDef, SessionState } from '@ekza-studio/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-studio/editor-core/testing';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { act, type ReactNode } from 'react';
import { userEvent } from 'vitest/browser';
import { EditorAppProvider } from '../../src';
import { readSynthetic, type Rendered, render } from '../render';

export const CHARACTER = 'chr_SyntheticWave001' as CharacterId;
export const CLIP = 'clp_SyntheticWave001' as ClipId;
export const RIG = 'rig_SyntheticWave001';
export const control = (key: string): ControlId => `${RIG}:${key}` as ControlId;
export const LOWER_ARM_L = control('fk.lowerArm.L');
export const LOWER_ARM_R = control('fk.lowerArm.R');
export const UPPER_ARM_L = control('fk.upperArm.L');
export const ROOT = control('root');

let fixtures: { readonly snapshot: DocSnapshot; readonly skeleton: SkeletonDesc } | null = null;

export async function loadFixtures(): Promise<{ readonly snapshot: DocSnapshot; readonly skeleton: SkeletonDesc }> {
  fixtures ??= {
    snapshot: (await readSynthetic('wave-doc.json')) as DocSnapshot,
    skeleton: (await readSynthetic('humanoid-skeleton.json')) as SkeletonDesc,
  };
  return fixtures;
}

/** A fake app over the wave document (call `loadFixtures` in `beforeAll` first). */
export function waveApp(opts?: { readonly platform?: 'mac' | 'other'; readonly skeleton?: boolean }): FakeEditorApp {
  if (fixtures === null) throw new Error('call loadFixtures() in beforeAll');
  return createFakeEditorApp({
    snapshot: fixtures.snapshot,
    ...(opts?.skeleton === false ? {} : { skeleton: fixtures.skeleton }),
    ...(opts?.platform === undefined ? {} : { platform: opts.platform }),
  });
}

const mounted = new Set<Rendered>();

/** Renders and remembers the tree, so `cleanup` (afterEach) unmounts it even when a test fails half-way. */
export async function mountPlain(node: ReactNode): Promise<Rendered> {
  const view = await render(node);
  mounted.add(view);
  return {
    container: view.container,
    rerender: (next) => view.rerender(next),
    async unmount() {
      if (!mounted.delete(view)) return;
      await view.unmount();
    },
  };
}

/** Mounts a panel inside the provider, in a box of a panel's size (virtualized lists need a height). */
export function mount(app: EditorApp, node: ReactNode, size = { width: 360, height: 640 }): Promise<Rendered> {
  return mountPlain(
    <EditorAppProvider app={app}>
      <div style={{ width: size.width, height: size.height, display: 'flex', flexDirection: 'column' }}>{node}</div>
    </EditorAppProvider>,
  );
}

/** Unmounts everything `mount`/`mountPlain` rendered (use in afterEach). */
export async function cleanup(): Promise<void> {
  for (const view of mounted) {
    mounted.delete(view);
    await view.unmount();
  }
}

export function by(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (element === null) throw new Error(`no element with data-testid="${id}"`);
  return element;
}

export function maybe(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

export function input(id: string): HTMLInputElement {
  const element = by(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${id} is not an input`);
  return element;
}

/** Arguments of every recorded run of `id`, oldest first. */
export function callsOf(app: FakeEditorApp, id: string): unknown[] {
  return app.calls.filter((call) => call.id === id).map((call) => call.args);
}

/** Session changes as act() updates (selection, time, overrides). */
export function setSession(app: EditorApp, patch: Partial<SessionState>): Promise<void> {
  return act(async () => app.session.setState(patch));
}

export function select(app: EditorApp, controls: readonly ControlId[]): Promise<void> {
  return setSession(app, { selection: { ...app.session.getState().selection, controls: [...controls] } });
}

export function setClipFrame(app: EditorApp, frame: number): Promise<void> {
  return setSession(app, { time: { ...app.session.getState().time, sceneFrame: frame } });
}

/** Writes records like an import would (one transaction, outside the undo stack's concerns of the tests). */
export function transact(
  app: EditorApp,
  fn: (tx: Parameters<Parameters<EditorApp['store']['transact']>[1]>[0]) => void,
) {
  return act(async () => {
    app.store.transact({ label: 'test setup' }, fn);
  });
}

export function controlRecord(app: EditorApp, key: string): ControlRecord {
  const record = app.store.get('controls', control(key));
  if (record === undefined) throw new Error(`no control ${key}`);
  return record;
}

/** A control under `parent` modelled on an existing one (new id, key and name). */
export function newControl(
  app: EditorApp,
  key: string,
  patch: Partial<Omit<ControlRecord, 'id' | 'key'>> = {},
): ControlRecord {
  const template = controlRecord(app, 'fk.hand.L');
  return { ...template, id: control(key), key, name: key, mirror: null, drives: null, ...patch };
}

export function newClip(app: EditorApp, id: string, patch: Partial<Omit<ClipRecord, 'id'>> = {}): ClipRecord {
  const template = app.store.get('clips', CLIP);
  if (template === undefined) throw new Error('no wave clip');
  return { ...template, id: id as ClipId, order: `b${id}`, ...patch };
}

export function newCamera(id: string, patch: Partial<Omit<CameraRecord, 'id'>> = {}): CameraRecord {
  return {
    id: id as CameraId,
    name: 'shotCam',
    projection: 'perspective',
    fovY: 2 * Math.atan(12 / 35),
    orthoHeight: 2,
    near: 0.01,
    far: 100,
    transform: { t: [0, 1.5, 4], q: [0, 0, 0, 1], s: [1, 1, 1] },
    target: [0, 1, 0],
    aspect: null,
    locked: true,
    order: 'a0',
    deleted: null,
    ...patch,
  };
}

/** Registers a no-op operator (to stand for one this panel needs but the fake app has not got). */
export function contributeOperator(app: EditorApp, id: `${string}.${string}`, poll?: OperatorDef<unknown>['poll']) {
  return app.contribute({
    kind: 'operator',
    def: { id, label: id, category: 'test', scope: 'global', ...(poll === undefined ? {} : { poll }), apply: () => {} },
  });
}

/** Real input (Chrome DevTools Protocol) wrapped in act(), one gesture per call so React settles in between. */
export const user = {
  click: (element: Element, options?: Parameters<typeof userEvent.click>[1]) =>
    act(async () => {
      await userEvent.click(element, options);
    }),
  dblClick: (element: Element) =>
    act(async () => {
      await userEvent.dblClick(element);
    }),
  rightClick: (element: Element) =>
    act(async () => {
      await userEvent.click(element, { button: 'right' });
    }),
  hover: (element: Element) =>
    act(async () => {
      await userEvent.hover(element);
    }),
  unhover: (element: Element) =>
    act(async () => {
      await userEvent.unhover(element);
    }),
  fill: (element: Element, text: string) =>
    act(async () => {
      await userEvent.fill(element, text);
    }),
  keyboard: (text: string) =>
    act(async () => {
      await userEvent.keyboard(text);
    }),
  selectOptions: (element: HTMLElement, value: string) =>
    act(async () => {
      await userEvent.selectOptions(element, value);
    }),
};

/** Waits for the next animation frame inside act(), so rAF-driven updates are flushed. */
export function nextFrame(): Promise<void> {
  return act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}
