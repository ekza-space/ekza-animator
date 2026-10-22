// AUTORIG-SPEC §4.2 (D3): step entries are serialized. Each entry runs after the previous one finished; a later step
// change supersedes an entry that has not started (it is skipped) or is running (it stops before its next stage), so
// two quick changes (Alt+2 then Alt+3) can never run ②'s workspace switch, mode or step start after ③'s session end.
import type { EditorApp } from '@ekza-studio/editor-core';
import { describe, expect, it } from 'vitest';
import type { WizardContext } from '../src/shell/context';
import { enterStep, entryQueue } from '../src/shell/entry';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('entryQueue (§4.2)', () => {
  it('runs entries one after another; a superseded running entry sees current() false and a queued one is skipped', async () => {
    const queue = entryQueue();
    const log: string[] = [];
    let release: () => void = () => {};
    const first = queue(async (current) => {
      log.push('a:start');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      log.push(`a:after current=${current()}`);
    });
    await tick();
    const second = queue(async () => {
      log.push('b:run');
    });
    const third = queue(async (current) => {
      log.push(`c:run current=${current()}`);
    });
    await tick();
    expect(log).toEqual(['a:start']);
    // a request made before the queue reached it is skipped outright
    const skipped: string[] = [];
    const late = entryQueue();
    void late(async () => {
      skipped.push('x');
    });
    await late(async () => {
      skipped.push('y');
    });
    expect(skipped).toEqual(['y']);
    release();
    await Promise.all([first, second, third]);
    // a stopped being current when b and c were requested; b was superseded by c before it started
    expect(log).toEqual(['a:start', 'a:after current=false', 'c:run current=true']);
  });

  it('a failing entry does not block the next one', async () => {
    const queue = entryQueue();
    const log: string[] = [];
    void queue(async () => {
      throw new Error('boom');
    });
    await tick();
    await queue(async () => {
      log.push('next');
    });
    expect(log).toEqual(['next']);
  });
});

/** A wizard context whose operators log their ids and settle on the next macrotask. */
function fakeContext(log: string[]): WizardContext {
  const state = { workspace: 'animate', rig: { mode: 'skeleton', quickRig: null } };
  const app = {
    operators: { get: () => ({}) },
    library: { loaded: false },
    session: { getState: () => state },
    async runUntyped(op: string, args?: { workspace?: string }) {
      log.push(op);
      await tick();
      if (op === 'workspace.set' && args?.workspace !== undefined) state.workspace = args.workspace;
      return { status: 'finished' as const };
    },
  } as unknown as EditorApp;
  return { app } as unknown as WizardContext;
}

describe('enterStep (§4.2)', () => {
  it('runs the order: end sessions, workspace, mode', async () => {
    const log: string[] = [];
    await enterStep(fakeContext(log), 'export', true);
    expect(log).toEqual(['edit.escape', 'workspace.set', 'rig.mode']);
  });

  it('a superseded entry stops before its workspace switch and mode', async () => {
    const log: string[] = [];
    let current = true;
    const ctx = fakeContext(log);
    const entry = enterStep(ctx, 'export', true, () => current);
    current = false;
    await entry;
    expect(log).toEqual(['edit.escape']);
  });
});
