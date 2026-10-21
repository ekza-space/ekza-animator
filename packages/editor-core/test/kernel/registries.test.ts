import { EkzaError } from '@ekza-studio/anim-core';
import { describe, expect, it } from 'vitest';
import type { ImporterDef, OperatorDef, ToolDef } from '../../src';
import { createRegistry } from '../../src/registries/registry';
import { createFakeEditorApp } from '../../src/testing';

describe('contribution registries', () => {
  it('lists in registration order, rejects duplicates, disposes only its own definition and notifies', () => {
    const registry = createRegistry<ImporterDef>('Importer');
    let notified = 0;
    const unsubscribe = registry.subscribe(() => notified++);
    const a: ImporterDef = { id: 'a', label: 'A', extensions: ['glb'], op: 'file.importModel' };
    const b: ImporterDef = { id: 'b', label: 'B', extensions: ['vrma'], op: 'file.importAnimation' };
    const disposeA = registry.register(a);
    registry.register(b);
    expect(registry.list()).toEqual([a, b]);
    expect(registry.list()).toBe(registry.list());
    expect(() => registry.register({ ...a, label: 'again' })).toThrow(EkzaError);
    expect(() => registry.register({ ...a, id: '' })).toThrow(EkzaError);
    disposeA();
    const again: ImporterDef = { ...a, label: 'A2' };
    registry.register(again);
    disposeA(); // stale disposer: no effect on the new definition
    expect(registry.get('a')).toBe(again);
    expect(registry.list().map((def) => def.id)).toEqual(['b', 'a']);
    expect(notified).toBe(4);
    unsubscribe();
    registry.register({ ...a, id: 'c' });
    expect(notified).toBe(4);
  });

  it('routes every contribution kind through app.contribute', () => {
    const app = createFakeEditorApp();
    const tool: ToolDef = { id: 'lasso', panel: 'viewport', label: 'Lasso', create: () => ({}) };
    const op: OperatorDef<unknown, unknown, unknown> = {
      id: 'acme.hello',
      label: 'Hello',
      category: 'acme',
      scope: 'global',
      apply: () => 'hi',
    };
    const disposers = [
      app.contribute({ kind: 'operator', def: op }),
      app.contribute({ kind: 'tool', def: tool }),
      app.contribute({ kind: 'keymap', bindings: [{ chord: { code: 'KeyH' }, op: 'acme.hello', scope: 'global' }] }),
      app.contribute({ kind: 'importer', def: { id: 'acme', label: 'Acme', extensions: ['acme'], op: 'acme.hello' } }),
      app.contribute({
        kind: 'exporter',
        def: {
          id: 'acme-export',
          label: 'Acme',
          extension: () => 'acme',
          poll: () => true,
          run: () => Promise.resolve([]),
        },
      }),
      app.contribute({
        kind: 'exportProfile',
        def: {
          id: 'acme/profile',
          label: 'Acme',
          platform: 'universal',
          profile: 'acme',
          kind: 'acme-export',
          maxBytes: 1,
          jsonMaxBytes: 1,
          ekza: false,
          rules: [],
        },
      }),
      app.contribute({ kind: 'menu', def: { id: 'acme.menu', menu: 'file', op: 'acme.hello', group: 'x', order: 1 } }),
    ];
    expect(app.operators.get('acme.hello')).toBe(op);
    expect(app.tools.get('viewport', 'lasso')).toBe(tool);
    expect(app.tools.list('viewport')).toEqual([tool]);
    expect(app.tools.list('graph')).toEqual([]);
    expect(() => app.tools.register(tool)).toThrow(EkzaError);
    const input = { code: 'KeyH', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false };
    expect(app.keymap.resolve(input, ['global'], 'press')?.op).toBe('acme.hello');
    expect(app.importers.get('acme')?.extensions).toEqual(['acme']);
    expect(app.exporters.get('acme-export')?.label).toBe('Acme');
    expect(app.exportProfiles.get('acme/profile')?.kind).toBe('acme-export');
    expect(app.menus.list().map((def) => def.id)).toEqual(['acme.menu']);
    for (const dispose of disposers) dispose();
    expect(app.operators.get('acme.hello')).toBeUndefined();
    expect(app.tools.get('viewport', 'lasso')).toBeUndefined();
    expect(app.keymap.resolve(input, ['global'], 'press')).toBeNull();
    expect(app.importers.list()).toEqual([]);
    expect(app.exporters.list()).toEqual([]);
    expect(app.exportProfiles.list()).toEqual([]);
    expect(app.menus.list()).toEqual([]);
  });
});

describe('operator registry', () => {
  it('validates ids and polls without throwing', () => {
    const app = createFakeEditorApp();
    const base = { label: 'X', category: 'test', scope: 'global', apply: () => undefined };
    const badId = (id: string) => id as `${string}.${string}`;
    expect(() => app.operators.register({ ...base, id: badId('nodot') })).toThrow(EkzaError);
    expect(() => app.operators.register({ ...base, id: badId('has space.x') })).toThrow(EkzaError);
    app.operators.register({
      ...base,
      id: 'test.poll',
      poll: (_ctx, args) => (args === 'ok' ? true : { ok: false, reason: `bad ${String(args)}` }),
    });
    app.operators.register({
      ...base,
      id: 'test.throws',
      poll: () => {
        throw new Error('exploded');
      },
    });
    app.operators.register({
      ...base,
      id: 'test.ctx',
      poll: (ctx) => (ctx.panel === 'graph' ? true : { ok: false, reason: 'graph only' }),
    });
    expect(app.operators.poll('test.poll', undefined, 'ok')).toBe(true);
    expect(app.operators.poll('test.poll', undefined, 'no')).toEqual({ ok: false, reason: 'bad no' });
    expect(app.operators.poll('test.throws')).toEqual({ ok: false, reason: 'exploded' });
    expect(app.operators.poll('test.ctx', { panel: 'graph' })).toBe(true);
    expect(app.operators.poll('test.ctx')).toEqual({ ok: false, reason: 'graph only' });
    expect(app.operators.poll('test.missing')).toEqual({ ok: false, reason: "unknown operator 'test.missing'" });
    expect(app.operators.list().map((def) => def.id)).toEqual(['test.poll', 'test.throws', 'test.ctx']);
  });
});
