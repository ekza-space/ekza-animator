// AUTORIG-SPEC §4.4 (D1): autosave housekeeping prunes one-shot handoff records older than 10 minutes once the slot
// is claimed; a store without the optional handoff members (M2a stores, fakes) keeps working unchanged.
import { describe, expect, it } from 'vitest';
import { HANDOFF_MAX_AGE_MS, startAutosave } from '../../src/app/autosave';
import { createFakeServices } from '../../src/testing';
import type { AutosaveStore } from '../../src/types';
import { opsAppWith } from '../builtin/support';

function store(extra: Partial<AutosaveStore> = {}): AutosaveStore {
  return {
    open: async () => 'as_0000000000000001',
    write: async () => ({ bytes: 0 }),
    listOrphans: async () => [],
    read: async () => null,
    remove: async () => {},
    ...extra,
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('handoff pruning in autosave housekeeping (§4.4)', () => {
  it('prunes records older than 10 minutes after the slot is claimed', async () => {
    const pruned: number[] = [];
    const services = {
      ...createFakeServices(),
      autosave: store({
        pruneHandoffs: async (olderThanMs) => {
          pruned.push(olderThanMs);
          return 2;
        },
      }),
    };
    const { app } = opsAppWith({ services });
    const controller = startAutosave(app);
    await controller.ready;
    await settle();
    expect(HANDOFF_MAX_AGE_MS).toBe(600_000);
    expect(pruned).toEqual([HANDOFF_MAX_AGE_MS]);
    expect(app.session.getState().autosave).toMatchObject({ enabled: true, slot: 'as_0000000000000001' });
    controller.dispose();
  });

  it('a failed prune is ignored, and a store without the member starts as before', async () => {
    for (const autosave of [
      store({ pruneHandoffs: () => Promise.reject(new Error('blocked')) }),
      store(),
    ]) {
      const { app } = opsAppWith({ services: { ...createFakeServices(), autosave } });
      const controller = startAutosave(app);
      await controller.ready;
      await settle();
      expect(app.session.getState().autosave.enabled).toBe(true);
      controller.dispose();
    }
  });
});
