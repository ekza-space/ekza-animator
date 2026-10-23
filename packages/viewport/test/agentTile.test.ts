// MCP-SPEC §5.15.3 (B3): one offscreen view_capture tile through the agent host — the mesh layer drawn from the
// tile's own camera into its own target, pixels top row first, the background where nothing is, the floor grid only
// on request, and nothing of the renderer's or the panes' state changed afterwards.
import type { CharacterId } from '@ekza-studio/doc';
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { LAYER, renderAgentTile } from '../src';
import { createRig, type Rig } from './helpers';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

function pixel(rgba: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4;
  return [rgba[i] as number, rgba[i + 1] as number, rgba[i + 2] as number, rgba[i + 3] as number];
}

describe('renderAgentTile (MCP-SPEC §5.15.3)', () => {
  it('draws the mesh layer from its own camera and leaves the renderer and the panes as they were', async () => {
    rig = await createRig();
    rig.layout('single');
    rig.frame();
    const host = await rig.vm.agentHost();
    // a red box above the floor on the mesh layer; a green one on the helpers layer (never in a tile)
    const box = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshBasicMaterial({ color: 0xff0000 }));
    box.position.set(0, 1.5, 0);
    box.layers.set(LAYER.mesh);
    const helper = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial({ color: 0x00ff00 }));
    helper.position.set(0, 1.5, 0.5);
    helper.layers.set(LAYER.helpers);
    host.scene.add(box, helper);
    host.scene.updateMatrixWorld();
    const paneCamera = rig.vm.camera('pane-single');
    const viewportBefore = rig.renderer.getViewport(new (await import('three')).Vector4()).toArray();

    const tile = renderAgentTile(host, {
      character: 'chr_none' as CharacterId,
      boneWorld: null,
      camera: {
        kind: 'look',
        projection: 'orthographic',
        position: [0, 1.5, 5],
        target: [0, 1.5, 0],
        up: [0, 1, 0],
        fovYDeg: 0,
        orthoHeightM: 2,
      },
      width: 96,
      height: 128,
      grid: false,
      background: '#000000',
    });
    expect([tile.width, tile.height, tile.rgba.length]).toEqual([96, 128, 96 * 128 * 4]);
    const centre = pixel(tile.rgba, 96, 48, 64);
    expect(centre[0]).toBeGreaterThan(200);
    expect(centre[1]).toBeLessThan(40);
    expect(pixel(tile.rgba, 96, 2, 2).slice(0, 3)).toEqual([0, 0, 0]);
    // the box sits in the middle rows: top row first means row 0 is the top of the frame (above the box)
    expect(pixel(tile.rgba, 96, 48, 5)[0]).toBeLessThan(40);

    expect(rig.renderer.getRenderTarget()).toBeNull();
    expect(rig.renderer.getViewport(new (await import('three')).Vector4()).toArray()).toEqual(viewportBefore);
    expect(rig.vm.camera('pane-single')).toEqual(paneCamera);
    host.scene.remove(box, helper);
  });

  it('renders a pane camera snapshot (the user’s view) at the tile’s aspect', async () => {
    rig = await createRig();
    rig.layout('single');
    rig.frame();
    const host = await rig.vm.agentHost();
    const snapshot = host.paneCamera('pane-single');
    const tile = renderAgentTile(host, {
      character: 'chr_none' as CharacterId,
      boneWorld: null,
      camera: { kind: 'snapshot', snapshot },
      width: 64,
      height: 64,
      grid: true,
    });
    expect(tile.rgba.length).toBe(64 * 64 * 4);
    expect(pixel(tile.rgba, 64, 32, 32)[3]).toBe(255);
    expect(rig.vm.camera('pane-single')).toEqual(snapshot);
  });
});
