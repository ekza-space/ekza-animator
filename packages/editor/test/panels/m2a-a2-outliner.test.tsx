// M2A-SPEC §5.5 (A2, browser mode): the Outliner dims the controls the IK/FK rule hides, following an animated or
// overridden ikFk at the next evaluation.
import type { ControlId } from '@ekza-animator/doc';
import type { EditorApp } from '@ekza-animator/editor-core';
import { createFakeIkEditorApp, withLimbIkRecords } from '@ekza-animator/editor-core/testing';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OutlinerPanel } from '../../src/panels/outliner/OutlinerPanel';
import { by, cleanup, control, loadFixtures, mount, setSession } from './helpers';

afterEach(cleanup);
let fixtures: Awaited<ReturnType<typeof loadFixtures>>;
beforeAll(async () => {
  fixtures = await loadFixtures();
});

const row = (id: ControlId): HTMLElement => by(`outliner-row-${id}`);

async function tick(app: EditorApp): Promise<void> {
  await act(async () => {
    app.evaluation.tick();
  });
}

describe('Outliner dimming by the IK/FK rule (§5.5)', () => {
  it('dims the FK chain of an IK leg and the IK controls of an FK arm; follows ikFk', async () => {
    const app = createFakeIkEditorApp({ snapshot: withLimbIkRecords(fixtures.snapshot), skeleton: fixtures.skeleton });
    const view = await mount(app, <OutlinerPanel app={app} instanceId="outliner#1" />, { width: 300, height: 1400 });
    await tick(app);
    expect(row(control('fk.upperLeg.L')).dataset.ikfkHidden).toBe('true');
    expect(row(control('fk.upperLeg.L')).className).toContain('opacity-50');
    expect(row(control('ik.leg.L')).dataset.ikfkHidden).toBeUndefined();
    expect(row(control('ik.arm.L')).dataset.ikfkHidden).toBe('true');
    expect(row(control('fk.toes.L')).dataset.ikfkHidden).toBeUndefined();
    const ik = control('ik.leg.L');
    await setSession(app, { overrides: new Map([[ik, { '@ikFk': 0 }]]) });
    await tick(app);
    expect(row(control('fk.upperLeg.L')).dataset.ikfkHidden).toBeUndefined();
    expect(row(control('ik.leg.L')).dataset.ikfkHidden).toBe('true');
    await view.unmount();
  });
});
