// ● Rec (STUDIO-TOUCH-SPEC §10.2, §16.4, AS-ST-10; T7): Halo's own setting laid over Auto Key as a removable `shell`
// override while an animation is active — every channel keys (mode *all*); Rec off is Auto Key off; the override goes
// with the shell, and Studio Pro's stored preference is never written.
import { describe, expect, it } from 'vitest';
import { createHaloStore, initialUi } from '../src/shell/store';
import { installRec, recPatch } from '../src/stages/animate/rec';
import { polybotApp, runOk } from './support';

describe('Rec as the shell override of Auto Key', () => {
  it('the patch: on keys every channel, off keys nothing', () => {
    expect(recPatch(true)).toEqual({ autoKey: true, autoKeyMode: 'all' });
    expect(recPatch(false)).toEqual({ autoKey: false });
  });

  it('applies while an animation is active, follows Rec, and is removed on unmount; the base is untouched', async () => {
    const { app, character } = await polybotApp();
    const base = { autoKey: app.prefs.getState().autoKey, autoKeyMode: app.prefs.getState().autoKeyMode };
    expect(base).toEqual({ autoKey: false, autoKeyMode: 'keyed-only' });
    const store = createHaloStore({ ...initialUi('animate') });
    const off = installRec(app, store);
    expect(app.prefs.getState()).toMatchObject({ autoKey: true, autoKeyMode: 'all' });
    store.set({ rec: false });
    expect(app.prefs.getState().autoKey).toBe(false);
    store.set({ rec: true });
    expect(app.prefs.getState().autoKey).toBe(true);

    // no active animation: no override (Auto Key has nothing to key)
    const clip = app.session.getState().activeClip[character];
    app.session.setState({ activeClip: {} });
    expect(app.prefs.getState()).toMatchObject(base);
    app.session.setState({ activeClip: clip === undefined ? {} : { [character]: clip } });
    expect(app.prefs.getState().autoKey).toBe(true);

    // a pose on a channel without keys is keyed at the playhead (Pro's keyed-only mode would leave it unkeyed)
    const forearm = app.store.list('controls').find((c) => c.key === 'fk.lowerArm.L')?.id;
    await runOk(app, 'channel.setValues', { edits: [{ control: forearm, channel: 'rz', value: 0.4 }] });
    const keyed = app.store.query
      .curvesOfClip(clip as never)
      .filter((curve) => curve.control === forearm && curve.channel === 'rz')
      .flatMap((curve) => app.store.query.keysOfCurve(curve.id));
    expect(keyed).toHaveLength(1);

    off();
    expect(app.prefs.getState()).toMatchObject(base);
    app.dispose();
  });
});
