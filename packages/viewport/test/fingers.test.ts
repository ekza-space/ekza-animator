// MVP-SPEC §4.11.15 acceptance (WP-5 test list): in a framed hand view on Seed-san and Polybot every finger control
// has a pick point at least 6 px from every other control's polyline. Needs the real GLB reader (WP-4), the
// auto-rig with mesh-based sizes (WP-3) and the control-shape library (lollipops, WP-1); it runs once they land.
import { EkzaError, getControlShape } from '@ekza-animator/anim-core';
import type { AssetId, CharacterId, ControlRecord, DocSnapshot, RigId } from '@ekza-animator/doc';
import { createFakeEditorApp } from '@ekza-animator/editor-core/testing';
import { parseGlb, skeletonFromGltf } from '@ekza-animator/io';
import { autoRig, type SkeletonDesc } from '@ekza-animator/rig';
import { afterEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { createRig, type Rig } from './helpers';

function implemented(probe: () => unknown): boolean {
  try {
    const result = probe();
    if (result instanceof Promise) result.catch(() => {});
    return true;
  } catch (error) {
    return !(error instanceof EkzaError && error.code === 'not-implemented');
  }
}

const READY =
  implemented(() => parseGlb(new Uint8Array(0))) &&
  implemented(() => skeletonFromGltf(undefined as never)) &&
  implemented(() => autoRig(undefined as never, undefined as never)) &&
  implemented(() => getControlShape('lollipop'));

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

async function fixtureBytes(name: string): Promise<Uint8Array> {
  const base64 = await commands.readFile(`../../fixtures/models/${name}`, 'base64');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** A one-character document around an auto-rig (test data; the import workflow is WP-7b's). */
function documentFor(skeleton: SkeletonDesc): DocSnapshot {
  const character = 'chr_FingerFixture01' as CharacterId;
  const rigId = 'rig_FingerFixture01' as RigId;
  const asset = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' as AssetId;
  const def = autoRig(skeleton, { character, rig: rigId });
  const byId = <T extends { readonly id: string }>(records: readonly T[]) =>
    Object.fromEntries(records.map((r) => [r.id, r]));
  return {
    format: 'ekza-animator-doc',
    schemaVersion: 1,
    minWriterVersion: 1,
    tableVersions: {},
    tables: {
      project: {
        project: {
          id: 'project',
          name: 'Fingers',
          schemaVersion: 1,
          minWriterVersion: 1,
          sceneFps: { num: 30, den: 1 },
          sceneRange: { start: 0, end: 60 },
          units: 'm',
          upAxis: 'Y',
        },
      },
      assets: {
        [asset]: {
          id: asset,
          name: 'model.vrm',
          ext: 'vrm',
          mime: 'model/gltf-binary',
          size: 0,
          role: 'model',
          provenance: null,
        },
      },
      characters: {
        [character]: {
          id: character,
          name: 'Model',
          asset,
          source: { kind: 'asset', asset },
          format: skeleton.format,
          rig: rigId,
          placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
          order: 'a0',
          deleted: null,
        },
      },
      rigs: byId([def.rig]),
      controls: byId(def.controls),
      constraints: byId(def.constraints),
      solvers: byId(def.solvers),
      cameras: {},
      clips: {},
      layers: {},
      curves: {},
      keys: {},
      // M6a schema 3 tables (empty)
      meshes: {},
      groups: {},
      palettes: {},
      swatches: {},
      imagePlanes: {},
      skeletons: {},
      joints: {},
    },
  };
}

describe.runIf(READY)('framing a selected control (acceptance round 1)', () => {
  it.each(['seed-san.vrm', 'polybot.vrm'])('%s: F on the hand alone shows every finger', async (name) => {
    const skeleton = skeletonFromGltf(await parseGlb(await fixtureBytes(name)));
    const app = createFakeEditorApp({ snapshot: documentFor(skeleton), skeleton });
    rig = await createRig({ app });
    rig.layout('split');
    const controls = app.store.list('controls');
    const fingers = controls.filter((c) => c.group === 'fingers' && c.side === 'L' && !c.hiddenByDefault);
    const hand = controls.find((c) => c.key === 'fk.hand.L');
    if (hand === undefined) throw new Error('no fk.hand.L');
    app.session.setState({ selection: { controls: [hand.id], keys: new Map(), channels: [] } });
    rig.frame();
    rig.vm.frame('pane-right', 'selection');
    rig.frame();
    const offScreen = fingers.filter((finger) => rig?.vm.controlPickPoint('pane-right', finger.id) === null);
    expect(offScreen.map((finger) => finger.key)).toEqual([]);
  });
});

describe.runIf(READY)('finger pick separation (WP-1, WP-3, WP-4)', () => {
  it.each(['seed-san.vrm', 'polybot.vrm'])(
    '%s: every left-hand finger has a pick point ≥ 6 px from other controls',
    async (name) => {
      const skeleton = skeletonFromGltf(await parseGlb(await fixtureBytes(name)));
      const app = createFakeEditorApp({ snapshot: documentFor(skeleton), skeleton });
      rig = await createRig({ app });
      rig.layout('split');
      const controls = app.store.list('controls');
      const visible = (c: ControlRecord) => !c.hiddenByDefault;
      const fingers = controls.filter((c) => c.group === 'fingers' && c.side === 'L' && visible(c));
      const hand = controls.find((c) => c.key === 'fk.hand.L');
      // Every left-hand finger bone of the model has its control (Seed-san 15; Polybot has one-segment fingers: 5).
      const fingerBones = Object.keys(skeleton.humanoid ?? {}).filter((bone) =>
        /^left(Thumb|Index|Middle|Ring|Little)/.test(bone),
      );
      expect(fingerBones.length).toBeGreaterThanOrEqual(5);
      expect(fingers.length).toBe(fingerBones.length);
      app.session.setState({
        selection: {
          controls: [...fingers.map((c) => c.id), ...(hand === undefined ? [] : [hand.id])],
          keys: new Map(),
          channels: [],
        },
      });
      rig.frame();
      rig.vm.frame('pane-right', 'selection');
      rig.frame();
      for (const finger of fingers) {
        const pick = rig.vm.controlPickPoint('pane-right', finger.id);
        expect({ key: finger.key, separation: Math.min(pick?.separationPx ?? 0, 6) }).toEqual({
          key: finger.key,
          separation: 6,
        });
      }
    },
  );
});

describe.runIf(READY)('picking at a control’s own pick point (acceptance round 2)', () => {
  it.each(['seed-san.vrm', 'polybot.vrm'])(
    '%s: at the default framing a click on a control’s pick point selects that control',
    async (name) => {
      const skeleton = skeletonFromGltf(await parseGlb(await fixtureBytes(name)));
      const app = createFakeEditorApp({ snapshot: documentFor(skeleton), skeleton });
      rig = await createRig({ app });
      rig.layout('split');
      rig.frame();
      let tested = 0;
      const misses: string[] = [];
      for (const control of app.store.list('controls')) {
        if (control.hiddenByDefault) continue;
        const pick = rig.vm.controlPickPoint('pane-right', control.id);
        // Another polyline within 1 px of the point is under the pointer equally: depth decides (and cycling).
        if (pick === null || pick.separationPx < 1) continue;
        tested++;
        const hit = rig.vm.pick('pane-right', pick.point.x, pick.point.y);
        const picked = hit?.kind === 'control' ? hit.control : null;
        if (picked !== control.id) misses.push(`${control.key} → ${picked ?? 'nothing'}`);
      }
      expect(misses).toEqual([]);
      expect(tested).toBeGreaterThanOrEqual(25);
    },
  );
});
