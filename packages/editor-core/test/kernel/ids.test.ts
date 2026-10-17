import { newId, seededIdSource } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { applyChannelEdits } from '../../src';
import { edit, kernelApp, setFrame, W, waveDoc } from './support';

describe('record ids', () => {
  it("come from the app's ID source, so seeded apps create identical documents", () => {
    const run = () => {
      const app = kernelApp({ snapshot: waveDoc(), options: { idSource: seededIdSource(1) } });
      setFrame(app, 5);
      edit(app, 'Key', (tx) =>
        applyChannelEdits(
          app,
          tx,
          [
            { control: W.lowerArmL, channel: 'rz', value: 0.1 },
            { control: W.handL, channel: 'rx', value: 0.2 },
          ],
          { key: 'force' },
        ),
      );
      const snapshot = app.store.snapshot();
      app.dispose();
      return snapshot;
    };
    const first = run();
    expect(run()).toEqual(first);
    expect(Object.keys(first.tables.curves)).toHaveLength(2);
  });

  it("seeds doc's default ID source while the app lives (other packages' records), then resets it", () => {
    const app = kernelApp({ options: { idSource: seededIdSource(7) } });
    const expected = newId('camera', seededIdSource(7));
    expect(newId('camera')).toBe(expected);
    app.dispose();
    expect(newId('camera')).not.toBe(newId('camera', seededIdSource(7)));
  });

  it('skip IDs the document already uses: a project saved in one seeded session reopens in the next', () => {
    const first = kernelApp({ snapshot: waveDoc(), options: { idSource: seededIdSource(1) } });
    setFrame(first, 5);
    // A new curve and its key: the first two IDs of the seeded sequence.
    edit(first, 'Key', (tx) =>
      applyChannelEdits(first, tx, [{ control: W.handL, channel: 'ry', value: 0.1 }], { key: 'force' }),
    );
    const saved = first.store.snapshot();
    first.dispose();
    // Same seed again (a page reload in ?e2e=1), the saved project loaded, then the same edit on another control.
    const second = kernelApp({ snapshot: saved, options: { idSource: seededIdSource(1) } });
    const curvesBefore = Object.keys(saved.tables.curves);
    setFrame(second, 5);
    edit(second, 'Key', (tx) =>
      applyChannelEdits(second, tx, [{ control: W.handL, channel: 'rx', value: 0.2 }], { key: 'force' }),
    );
    const curvesAfter = Object.keys(second.store.snapshot().tables.curves);
    expect(curvesAfter).toHaveLength(curvesBefore.length + 1);
    expect(curvesAfter).toEqual(expect.arrayContaining(curvesBefore));
    second.dispose();
  });
});
