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
});
