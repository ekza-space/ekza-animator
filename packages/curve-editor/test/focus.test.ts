// The Graph Editor focus registry (STUDIO-TOUCH-SPEC §20.3 item 18; T10 moved it from Studio Pro's Graph panel): Pro's
// Graph panels and a touch shell's Curves layer share it — the first attached editor registers the graph
// contributions, `graph.frame` acts on the focused one (else the newest), the last one to leave removes them.
import { afterEach, describe, expect, it } from 'vitest';
import { attachGraphEditor, focusedGraphEditor, focusGraphEditor } from '../src';
import { type Mounted, mount, settle, waveApp } from './support/app';

const mounts: Mounted[] = [];
afterEach(() => {
  for (const m of mounts.splice(0)) m.dispose();
});

describe('the focus registry', () => {
  it('registers once, focuses, and unregisters with the last editor', async () => {
    const app = await waveApp();
    const a = mount(app);
    const b = mount(app);
    mounts.push(a, b);
    expect(app.operators.get('graph.frame')).toBeUndefined();
    const handleA = { controller: a.controller, surface: a.overlay };
    const handleB = { controller: b.controller, surface: b.overlay, scale: 1.8 };
    const offA = attachGraphEditor(app, handleA);
    const offB = attachGraphEditor(app, handleB);
    expect(app.operators.get('graph.frame')).toBeDefined();
    expect(focusedGraphEditor(app)).toBe(handleB);
    focusGraphEditor(app, handleA);
    expect(focusedGraphEditor(app)).toBe(handleA);
    // graph.frame acts on the focused editor
    b.controller.setView({ ...b.controller.view, sx: b.controller.view.sx * 4 });
    const zoomedB = b.controller.view;
    a.controller.setView({ ...a.controller.view, sx: a.controller.view.sx * 4 });
    await app.run('graph.frame', { what: 'all' });
    await settle();
    expect(b.controller.view).toEqual(zoomedB);
    expect(a.controller.view.sx).toBeLessThan(zoomedB.sx);
    offA();
    expect(focusedGraphEditor(app)).toBe(handleB);
    expect(app.operators.get('graph.frame')).toBeDefined();
    offB();
    expect(focusedGraphEditor(app)).toBeNull();
    expect(app.operators.get('graph.frame')).toBeUndefined();
  });
});
