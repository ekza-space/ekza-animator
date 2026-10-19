// B0a skeleton of mesh-view (M6A-SPEC §4.4, §9 B0a; handed to B6 with this directory): the classes exist with their
// final shapes and refuse construction with `not-implemented` until B6 lands them; the size marker is exported.
import { describe, expect, it } from 'vitest';
import { ComponentPicker, EditMeshView, MeshSurface, VIEW_MARKER } from '../src';

const theme = {
  halo: 0x14151a,
  vertex: 0xd17bff,
  selected: 0xffa31a,
  hover: 0xffe58a,
  wire: 0x14151a,
  wireMode: 0xc8ccd4,
  hardEdge: 0x14151a,
  normalFace: 0x3fd1d9,
  normalVertex: 0xb18cff,
  faceFront: 0x56b4e9,
  faceBack: 0xe69f00,
  symPlane: 0x5cc8ff,
  lintNgon: 0xe3b34a,
  lintError: 0xef6b6b,
  soft: [0xffd84d, 0xff8a3d, 0xd9363e, 0x4a1a1e] as const,
};
const layers = { surface: 0, components: 6, normals: 7, lint: 8, helpers: 9 };

describe('mesh-view skeleton (B0a)', () => {
  it('names the check-size marker of the mesh-view chunk', () => {
    expect(VIEW_MARKER).toBe('ekza-mesh-view');
  });

  it('refuses to build views and pickers until B6 lands them', () => {
    expect(() => new EditMeshView({ theme, layers })).toThrow(/mesh-view.EditMeshView/);
    expect(() => new MeshSurface({ theme, layers })).toThrow(/mesh-view.MeshSurface/);
    expect(() => new ComponentPicker()).toThrow(/mesh-view.ComponentPicker/);
  });
});
