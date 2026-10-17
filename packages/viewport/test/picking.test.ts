import type { ControlId, ControlRecord } from '@ekza-animator/doc';
import { afterEach, describe, expect, it } from 'vitest';
import type { PickResult } from '../src';
import { segmentIntersectsRect } from '../src/picking/geometry';
import { compareHits } from '../src/picking/picker';
import { createRig, pointer, type Rig } from './helpers';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

const PANE = 'pane-right';

function control(r: Rig, key: string): ControlRecord {
  const record = r.app.store.list('controls').find((c) => c.key === key);
  if (record === undefined) throw new Error(`no control ${key}`);
  return record;
}

function select(r: Rig, ids: readonly ControlId[]): void {
  r.app.session.setState({ selection: { controls: [...ids], keys: new Map(), channels: [] } });
}

function setTool(r: Rig, tool: string): void {
  r.app.session.setState({ tools: { ...r.app.session.getState().tools, viewport: tool } });
}

/** Page coordinates of a pane point. */
function page(r: Rig, x: number, y: number): { x: number; y: number } {
  const rect = r.panes.get(PANE)?.getBoundingClientRect();
  return { x: (rect?.left ?? 0) + x, y: (rect?.top ?? 0) + y };
}

function click(r: Rig, x: number, y: number, init?: PointerEventInit): void {
  const element = r.panes.get(PANE) as HTMLElement;
  const p = page(r, x, y);
  pointer(element, 'pointerdown', p.x, p.y, init);
  pointer(element, 'pointerup', p.x, p.y, init);
}

function selectCalls(r: Rig): { ids: readonly string[]; mode: string }[] {
  return r.app.calls
    .filter((call) => call.id === 'select.controls')
    .map((call) => call.args as { ids: readonly string[]; mode: string });
}

const controlsOf = (hits: readonly PickResult[]): string[] =>
  hits.flatMap((hit) => (hit.kind === 'control' ? [hit.control] : []));

describe('control picking', () => {
  it('picks every well-separated control at its projected pick point (±1 px)', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.frame();
    let tested = 0;
    for (const record of rig.app.store.list('controls')) {
      const pick = rig.vm.controlPickPoint(PANE, record.id);
      expect({ key: record.key, visible: pick !== null }).toEqual({ key: record.key, visible: true });
      if (pick === null || pick.separationPx < 7) continue;
      tested++;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const hit = rig.vm.pick(PANE, pick.point.x + dx, pick.point.y + dy);
        expect({ key: record.key, dx, dy, hit: hit?.kind === 'control' ? hit.control : null }).toEqual({
          key: record.key,
          dx,
          dy,
          hit: record.id,
        });
      }
    }
    expect(tested).toBeGreaterThanOrEqual(20);
  });

  it('projects control pick points onto the shape polyline with the pane camera', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.frame();
    const hand = control(rig, 'fk.hand.L');
    const point = rig.vm.controlScreenPoint(PANE, hand.id);
    expect(point).not.toBeNull();
    const hit = rig.vm
      .pickCandidates(PANE, point?.x ?? 0, point?.y ?? 0)
      .find((h) => h.kind === 'control' && h.control === hand.id);
    expect(hit?.kind === 'control' ? hit.distancePx : Number.NaN).toBeLessThan(1e-3);
    expect(hit?.kind === 'control' ? hit.depth : 0).toBeCloseTo(point?.depth ?? -1, 3);
  });

  it('orders candidates by screen distance, then depth, then the smaller control (v0.3 integration)', () => {
    const hit = (control: string, depth: number, size: number, distancePx = 0.5) => ({
      control: control as ControlId,
      character: 'chr_x' as never,
      depth,
      size,
      distancePx,
    });
    const sorted = [hit('a', 2.5, 0.1), hit('b', 1.001, 0.5), hit('c', 1.002, 0.05), hit('d', 0.5, 1)].sort(
      compareHits,
    );
    // Equally under the pointer (same 1 px bucket): nearest depth first; b and c share the 1 cm depth bucket, so the
    // smaller control (c) wins.
    expect(sorted.map((h) => h.control)).toEqual(['d', 'c', 'b', 'a']);
    // A click on a control's own curve beats a control nearer the camera a few pixels away (acceptance round 2).
    const own = hit('own', 3, 0.3, 0);
    const near = hit('near', 0.2, 0.05, 4.5);
    expect([near, own].sort(compareHits).map((h) => h.control)).toEqual(['own', 'near']);
  });

  it('returns candidates in that order wherever several controls overlap', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.frame();
    let overlaps = 0;
    for (let x = 150; x < 460; x += 3) {
      for (let y = 120; y < 480; y += 3) {
        const hits = rig.vm.pickCandidates(PANE, x, y);
        if (hits.length < 2) continue;
        overlaps++;
        for (let i = 1; i < hits.length; i++) {
          const a = hits[i - 1];
          const b = hits[i];
          if (a?.kind !== 'control' || b?.kind !== 'control') continue;
          expect(Math.floor(a.distancePx)).toBeLessThanOrEqual(Math.floor(b.distancePx));
          if (Math.floor(a.distancePx) === Math.floor(b.distancePx)) {
            expect(Math.floor(a.depth / 0.01)).toBeLessThanOrEqual(Math.floor(b.depth / 0.01));
          }
          expect(a.distancePx).toBeLessThanOrEqual(6);
        }
      }
    }
    expect(overlaps).toBeGreaterThan(0);
  });

  it('puts the manipulator before controls and finds every handle at its grab point', async () => {
    rig = await createRig();
    rig.layout('split');
    const arm = control(rig, 'fk.lowerArm.L');
    select(rig, [arm.id]);
    setTool(rig, 'rotate');
    rig.frame();
    for (const handle of ['rx', 'ry', 'rz', 'rview'] as const) {
      const p = rig.vm.manipulatorScreenPoint(PANE, handle);
      expect(p).not.toBeNull();
      const hits = rig.vm.pickCandidates(PANE, p?.x ?? 0, p?.y ?? 0);
      expect(hits[0]).toEqual({ kind: 'manipulator', handle });
    }
    // Over the selected control itself (manipulator centre is empty for rotate), the control is picked.
    const armPoint = rig.vm.controlScreenPoint(PANE, arm.id);
    const centre = rig.vm.pick(PANE, armPoint?.x ?? 0, armPoint?.y ?? 0);
    expect(centre?.kind).toBe('control');
  });

  it('picks joints only when the skeleton is shown and the selection mask allows joints', async () => {
    rig = await createRig();
    rig.layout('split', { display: { skeleton: true, controls: false } });
    rig.frame();
    const runtime = rig.app.characters.list()[0];
    const node = runtime?.skeleton.humanoid?.leftHand ?? -1;
    const world = runtime?.pose.boneWorld.subarray(node * 16 + 12, node * 16 + 15) ?? new Float64Array(3);
    const p = rig.vm.project(PANE, [world[0] ?? 0, world[1] ?? 0, world[2] ?? 0]);
    expect(p).not.toBeNull();
    expect(rig.vm.pickCandidates(PANE, p?.x ?? 0, p?.y ?? 0)).toEqual([]);
    rig.app.session.setState({
      tools: { ...rig.app.session.getState().tools, selectionMask: { controls: true, joints: true, meshes: false } },
    });
    const hits = rig.vm.pickCandidates(PANE, p?.x ?? 0, p?.y ?? 0);
    expect(hits.some((h) => h.kind === 'joint' && h.node === node)).toBe(true);
  });
});

describe('select tool', () => {
  it('selects the clicked control with the modifier modes, and clears on an empty click', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.frame();
    const arm = control(rig, 'fk.upperArm.L');
    const p = rig.vm.controlScreenPoint(PANE, arm.id);
    click(rig, p?.x ?? 0, p?.y ?? 0);
    click(rig, p?.x ?? 0, p?.y ?? 0, { shiftKey: true });
    click(rig, p?.x ?? 0, p?.y ?? 0, { ctrlKey: true });
    click(rig, p?.x ?? 0, p?.y ?? 0, { ctrlKey: true, shiftKey: true });
    click(rig, 5, 5);
    const calls = selectCalls(rig);
    expect(calls.map((c) => c.mode)).toEqual(['replace', 'toggle', 'remove', 'add', 'replace']);
    expect(calls.slice(0, 4).every((c) => c.ids.length === 1 && c.ids[0] === arm.id)).toBe(true);
    expect(calls[4]?.ids).toEqual([]);
  });

  it('cycles through overlapping controls on repeated clicks at the same spot', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.frame();
    let spot: { x: number; y: number; ids: string[] } | null = null;
    for (let x = 150; x < 460 && spot === null; x += 2) {
      for (let y = 120; y < 480 && spot === null; y += 2) {
        const ids = controlsOf(rig.vm.pickCandidates(PANE, x, y));
        if (ids.length >= 2) spot = { x, y, ids };
      }
    }
    expect(spot).not.toBeNull();
    const s = spot as { x: number; y: number; ids: string[] };
    click(rig, s.x, s.y);
    click(rig, s.x + 1, s.y);
    click(rig, s.x, s.y + 1);
    const picked = selectCalls(rig).map((c) => c.ids[0]);
    expect(picked[0]).toBe(s.ids[0]);
    expect(picked[1]).toBe(s.ids[1]);
    expect(picked[2]).toBe(s.ids[2 % s.ids.length]);
    // A click elsewhere restarts the cycle.
    const far = rig.vm.controlScreenPoint(PANE, control(rig, 'root').id);
    click(rig, far?.x ?? 0, far?.y ?? 0);
    click(rig, s.x, s.y);
    expect(selectCalls(rig).at(-1)?.ids[0]).toBe(s.ids[0]);
  });

  it('modifier clicks act on the nearest control and never cycle (acceptance round 2)', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.frame();
    let spot: { x: number; y: number; ids: string[] } | null = null;
    for (let x = 150; x < 460 && spot === null; x += 2) {
      for (let y = 120; y < 480 && spot === null; y += 2) {
        const ids = controlsOf(rig.vm.pickCandidates(PANE, x, y));
        if (ids.length >= 2) spot = { x, y, ids };
      }
    }
    expect(spot).not.toBeNull();
    const s = spot as { x: number; y: number; ids: string[] };
    // Shift twice toggles the same control on and off; Mod+Shift twice adds the same control.
    click(rig, s.x, s.y, { shiftKey: true });
    click(rig, s.x, s.y, { shiftKey: true });
    click(rig, s.x, s.y, { ctrlKey: true, shiftKey: true });
    click(rig, s.x, s.y, { ctrlKey: true, shiftKey: true });
    // A plain click after them starts a fresh cycle at the nearest control.
    click(rig, s.x, s.y);
    click(rig, s.x, s.y);
    expect(selectCalls(rig)).toEqual([
      { ids: [s.ids[0]], mode: 'toggle' },
      { ids: [s.ids[0]], mode: 'toggle' },
      { ids: [s.ids[0]], mode: 'add' },
      { ids: [s.ids[0]], mode: 'add' },
      { ids: [s.ids[0]], mode: 'replace' },
      { ids: [s.ids[1]], mode: 'replace' },
    ]);
  });

  it('marquee-selects every control whose polyline crosses the rectangle', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.frame();
    const hand = rig.vm.controlScreenPoint(PANE, control(rig, 'fk.hand.L').id);
    const finger = rig.vm.controlScreenPoint(PANE, control(rig, 'fk.indexProximal.L').id);
    if (hand === null || finger === null) throw new Error('hand controls are not visible');
    const rect = {
      x0: Math.min(hand.x, finger.x) - 3,
      y0: Math.min(hand.y, finger.y) - 3,
      x1: Math.max(hand.x, finger.x) + 3,
      y1: Math.max(hand.y, finger.y) + 3,
    };
    const ids = rig.vm.marquee(PANE, rect);
    expect(ids).toContain(control(rig, 'fk.hand.L').id);
    expect(ids).toContain(control(rig, 'fk.indexProximal.L').id);
    expect(ids).not.toContain(control(rig, 'fk.hand.R').id);
    expect(ids).not.toContain(control(rig, 'root').id);

    const element = rig.panes.get(PANE) as HTMLElement;
    const a = page(rig, rect.x0, rect.y0);
    const b = page(rig, rect.x1, rect.y1);
    pointer(element, 'pointerdown', a.x, a.y, { shiftKey: true });
    pointer(element, 'pointermove', (a.x + b.x) / 2, (a.y + b.y) / 2, { shiftKey: true, buttons: 1 });
    expect(element.querySelector('[data-testid="viewport-marquee"]')).not.toBeNull();
    pointer(element, 'pointermove', b.x, b.y, { shiftKey: true, buttons: 1 });
    pointer(element, 'pointerup', b.x, b.y, { shiftKey: true });
    expect(element.querySelector('[data-testid="viewport-marquee"]')).toBeNull();
    const call = selectCalls(rig).at(-1);
    expect(call?.mode).toBe('toggle');
    expect([...(call?.ids ?? [])].sort()).toEqual([...ids].sort());
  });

  it('crossing test: segments through, inside or outside the rectangle', () => {
    expect(segmentIntersectsRect(-10, 5, 30, 5, 0, 0, 10, 10)).toBe(true); // passes through, both ends outside
    expect(segmentIntersectsRect(2, 2, 3, 3, 0, 0, 10, 10)).toBe(true); // inside
    expect(segmentIntersectsRect(-5, -5, -1, 20, 0, 0, 10, 10)).toBe(false);
    expect(segmentIntersectsRect(-5, 12, 12, -5, 0, 0, 10, 10)).toBe(true); // diagonal through a corner region
    expect(segmentIntersectsRect(-5, 30, 30, 12, 0, 0, 10, 10)).toBe(false);
    expect(segmentIntersectsRect(10, -5, 10, 15, 0, 0, 10, 10)).toBe(true); // along an edge
  });
});
