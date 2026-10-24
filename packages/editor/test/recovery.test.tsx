// M2A-SPEC §5.20: the Recovery dialog (rows with name, time, counts and size; Recover, Discard after a confirm, Later)
// and the shell's side of autosave: the dialog opens by itself once per page load when orphaned slots exist (after
// the first-run dialog), never with a fake host, and `beforeunload` cleans a page that is not dirty.
import type { AutosaveSlotInfo, AutosaveStore } from '@ekza-studio/editor-core';
import { GLOBAL_SCOPE } from '@ekza-studio/editor-core';
import { describe, expect, it } from 'vitest';
import { DialogHost } from '../src/dialogs/DialogHost';
import { relativeTime, sizeText } from '../src/dialogs/RecoveryDialog';
import { promptRecovery, startShellAutosave } from '../src/shell/autosave';
import { DEFAULT_PARAMS } from '../src/test-api/params';
import { byTestId, render, update } from './render';
import { createTestShell, ShellFrame, waitFor } from './shell-helpers';

const NOW = Date.now();
const SLOTS: AutosaveSlotInfo[] = [
  {
    id: 'as_0000000000000001',
    projectName: 'Walk cycle',
    savedAt: NOW - 5 * 60_000,
    characters: 1,
    clips: 3,
    bytes: 12_345,
    appVersion: '0.2.0',
    schemaVersion: 2,
  },
  {
    id: 'as_0000000000000002',
    projectName: 'Attack',
    savedAt: NOW - 3 * 24 * 3_600_000,
    characters: 2,
    clips: 1,
    bytes: 10_800_000,
    appVersion: '0.2.0',
    schemaVersion: 2,
  },
];

const body = (id: string): HTMLElement => byTestId(document.body, id);

/** A test shell (not e2e: Discard asks) with recording stand-ins for file.recover and file.discardRecovery. */
function setup() {
  const test = createTestShell({ params: { ...DEFAULT_PARAMS, e2e: false } });
  const runs: { id: string; args: unknown }[] = [];
  for (const id of ['file.recover', 'file.discardRecovery'] as const) {
    test.app.contribute({
      kind: 'operator',
      def: {
        id,
        label: id,
        category: 'file',
        scope: GLOBAL_SCOPE,
        apply: (_ctx, args) => {
          runs.push({ id, args });
          const slot = (args as { slot: string }).slot;
          const recovery = test.app.session.getState().recovery.filter((entry) => entry.id !== slot);
          test.app.session.setState(id === 'file.recover' ? { recovery, dialog: null } : { recovery });
        },
      },
    });
  }
  test.app.session.setState({ recovery: SLOTS });
  return { ...test, runs };
}

describe('recovery dialog', () => {
  it('formats times and sizes plainly', () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe('just now');
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5 min ago');
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3 h ago');
    expect(relativeTime(NOW - 24 * 3_600_000, NOW)).toBe('1 day ago');
    expect(relativeTime(NOW - 3 * 24 * 3_600_000, NOW)).toBe('3 days ago');
    expect(sizeText(980)).toBe('980 B');
    expect(sizeText(12_345)).toBe('12.3 kB');
    expect(sizeText(10_800_000)).toBe('10.8 MB');
  });

  it('lists the slots and recovers one; the dialog closes', async () => {
    const { shell, app, runs } = setup();
    const view = await render(
      <ShellFrame shell={shell}>
        <DialogHost />
      </ShellFrame>,
    );
    await update(() => shell.runFromUi('ui.open', { dialog: 'recovery' }));
    await waitFor(() => document.querySelector('[data-testid="recovery-dialog"]') !== null);
    const row = body('recovery-row-as_0000000000000001').textContent ?? '';
    expect(row).toContain('Walk cycle');
    expect(row).toContain('5 min ago');
    expect(row).toContain('1 character');
    expect(row).toContain('3 clips');
    expect(row).toContain('12.3 kB');
    expect(body('recovery-row-as_0000000000000002').textContent).toContain('10.8 MB');
    await update(() => body('recovery-recover-as_0000000000000001').click());
    await waitFor(() => runs.length === 1);
    expect(runs).toEqual([{ id: 'file.recover', args: { slot: 'as_0000000000000001' } }]);
    await waitFor(() => app.session.getState().dialog === null);
    await view.unmount();
  });

  it('asks before discarding; cancel keeps the slot, confirm removes it; Later closes the dialog', async () => {
    const { shell, app, runs } = setup();
    const view = await render(
      <ShellFrame shell={shell}>
        <DialogHost />
      </ShellFrame>,
    );
    await update(() => shell.runFromUi('ui.open', { dialog: 'recovery' }));
    await waitFor(() => document.querySelector('[data-testid="recovery-dialog"]') !== null);
    await update(() => body('recovery-discard-as_0000000000000002').click());
    await waitFor(() => document.querySelector('[data-testid="confirm-dialog"]') !== null);
    expect(body('confirm-dialog').textContent).toContain("'Attack'");
    await update(() => body('confirm-cancel').click());
    await waitFor(() => document.querySelector('[data-testid="confirm-dialog"]') === null);
    expect(runs).toEqual([]);
    await update(() => body('recovery-discard-as_0000000000000002').click());
    await waitFor(() => document.querySelector('[data-testid="confirm-ok"]') !== null);
    await update(() => body('confirm-ok').click());
    await waitFor(() => runs.length === 1);
    expect(runs[0]).toEqual({ id: 'file.discardRecovery', args: { slot: 'as_0000000000000002' } });
    await waitFor(() => document.querySelector('[data-testid="recovery-row-as_0000000000000002"]') === null);
    expect(app.session.getState().recovery.map((slot) => slot.id)).toEqual(['as_0000000000000001']);
    await update(() => body('recovery-later').click());
    await waitFor(() => app.session.getState().dialog === null);
    expect(app.session.getState().recovery).toHaveLength(1);
    await view.unmount();
  });
});

/** A store with orphans whose claim never resolves its info (enough for the prompt). */
function storeWith(orphans: readonly AutosaveSlotInfo[]): AutosaveStore & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    open: () => Promise.resolve('as_ownownownownown1'),
    write: () => Promise.resolve({ bytes: 0 }),
    listOrphans: () => Promise.resolve(orphans),
    read: () => Promise.resolve(null),
    remove: (slot) => {
      removed.push(slot);
      return Promise.resolve();
    },
  };
}

describe('shell autosave', () => {
  it('a fake host (no autosave field) starts nothing', () => {
    const { app } = createTestShell();
    expect(app.session.getState().autosave.enabled).toBe(false);
    expect(app.services.autosave).toBeUndefined();
  });

  it('prompts once per page load, after the first-run dialog, and never again after Later', async () => {
    const { app, shell } = createTestShell();
    const store = storeWith(SLOTS);
    Object.assign(app.services, { autosave: store });
    app.prefs.setState({ firstRunDone: false });
    app.session.setState({ dialog: 'firstRun' });
    const target = new EventTarget();
    const runFromUi = (op: string, args?: unknown) => shell.runFromUi(op, args);
    const stopAutosave = startShellAutosave({ app, target });
    const stopPrompt = promptRecovery({ app, runFromUi });
    const stop = (): void => {
      stopPrompt();
      stopAutosave();
    };
    await waitFor(() => app.session.getState().recovery.length === 2);
    expect(app.session.getState().dialog).toBe('firstRun');
    app.prefs.setState({ firstRunDone: true });
    app.session.setState({ dialog: null });
    await waitFor(() => app.session.getState().dialog === 'recovery');
    await shell.runFromUi('ui.close');
    app.session.setState({ recovery: [...SLOTS] });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(app.session.getState().dialog).toBeNull();
    // beforeunload while not dirty removes this page's snapshot; while dirty it is kept
    app.session.setState({ dirty: true });
    target.dispatchEvent(new Event('beforeunload'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.removed).toEqual([]);
    app.session.setState({ dirty: false });
    store.removed.length = 0;
    target.dispatchEvent(new Event('beforeunload'));
    await waitFor(() => store.removed.includes('as_ownownownownown1'));
    stop();
  });

  it('unsaved work is written on pagehide and when the page is hidden; clean work is not (S24, T0 patch)', async () => {
    const { app } = createTestShell();
    const store = storeWith([]);
    const writes: string[] = [];
    const write = store.write;
    store.write = (...args) => {
      writes.push(args[0]);
      return write(...args);
    };
    Object.assign(app.services, { autosave: store });
    const target = new EventTarget();
    const stop = startShellAutosave({ app, target });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const before = writes.length;
    target.dispatchEvent(new Event('pagehide'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(writes.length).toBe(before);
    app.session.setState({ dirty: true });
    // the test page is visible: a visibilitychange to visible writes nothing
    target.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(writes.length).toBe(before);
    target.dispatchEvent(new Event('pagehide'));
    await waitFor(() => writes.length === before + 1);
    expect(writes.at(-1)).toBe('as_ownownownownown1');
    stop();
  });

  it('a page without a first-run dialog (from=autorig) prompts at once, before the first run is done (AR-D9-2)', async () => {
    const { app, shell } = createTestShell();
    Object.assign(app.services, { autosave: storeWith(SLOTS) });
    app.prefs.setState({ firstRunDone: false });
    const runFromUi = (op: string, args?: unknown) => shell.runFromUi(op, args);
    // Studio's own page waits for the first-run dialog
    const waiting = promptRecovery({ app, runFromUi });
    app.session.setState({ recovery: [...SLOTS] });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(app.session.getState().dialog).toBeNull();
    waiting();
    // a page that opens none (the hand-over's URL, reloaded) offers the autosave right away
    const stop = promptRecovery({ app, runFromUi, firstRun: false });
    await waitFor(() => app.session.getState().dialog === 'recovery');
    expect(app.prefs.getState().firstRunDone).toBe(false);
    stop();
  });

  it('a host without storage (autosave: null) turns autosave off and says so once', async () => {
    const { app, shell, toasts } = createTestShell();
    Object.assign(app.services, { autosave: null });
    const stop = startShellAutosave({ app, target: null });
    await waitFor(() => toasts.store.getState().toasts.length === 1);
    expect(toasts.store.getState().toasts[0]).toMatchObject({
      kind: 'info',
      text: 'Autosave is off: this browser blocks storage.',
    });
    expect(app.session.getState().autosave.enabled).toBe(false);
    expect((await shell.runFromUi('ui.open', { dialog: 'recovery' })).status).toBe('cancelled');
    stop();
  });
});
