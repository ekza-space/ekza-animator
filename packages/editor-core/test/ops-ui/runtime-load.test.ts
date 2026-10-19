// M6A-SPEC §5.27 (B11): the B11 runtime chunk (the Last-op card's tracker, the adjust engine, the card preview, the
// capture window's state machine and the typed-value grammar) is not in the eager route: an editor that never enters
// Model and records no LastRun never loads it; the first Model entry does. (One test per file: the chunk is loaded
// once per module graph.)
import { describe, expect, it, vi } from 'vitest';
import { opsRuntime, switchWorkspace } from '../../src';
import { createMesh, meshTestApp } from '../mesh/support';

const DIGIT1 = { code: 'Digit1', key: '1', shift: false, mod: false, alt: false };

describe('the B11 runtime chunk (§5.27)', () => {
  it('stays unloaded in Animate (runs that record no LastRun) and loads on the first Model entry', async () => {
    const t = await meshTestApp();
    expect(opsRuntime()).toBeNull();
    createMesh(t, 'msh_Cube');
    await t.app.run('edit.undo');
    await t.app.run('edit.redo');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(opsRuntime()).toBeNull();
    // The eager shim answers the keyboard adapter without the chunk: nothing is armed, no key is taken.
    expect(t.app.capture.state).toEqual({ armed: null, field: null, text: null });
    expect(t.app.capture.key(DIGIT1)).toBe(false);
    switchWorkspace(t.app, 'model');
    await vi.waitFor(() => expect(opsRuntime()).not.toBeNull());
  });
});
