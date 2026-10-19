// The mesh-view entry (M6A-SPEC §4.4, §2): the size marker and the three classes. B0a's skeleton refused construction
// with `not-implemented`; B6 lands the bodies, so the classes now construct and dispose cleanly (literal update of the
// B0a case "refuses to build views and pickers until B6 lands them").
import { describe, expect, it } from 'vitest';
import { ComponentPicker, EditMeshView, MeshSurface, VIEW_MARKER } from '../src';
import { LAYERS, THEME } from './support';

describe('mesh-view entry', () => {
  it('names the check-size marker of the mesh-view chunk', () => {
    expect(VIEW_MARKER).toBe('ekza-mesh-view');
  });

  it('builds views and pickers (B6) and disposes them twice without error', () => {
    const view = new EditMeshView({ theme: THEME, layers: LAYERS });
    const surface = new MeshSurface({ theme: THEME, layers: LAYERS });
    const picker = new ComponentPicker();
    expect(view.root.name).toBe('ekza-mesh-view');
    expect(surface.root.children.length).toBeGreaterThan(0);
    view.dispose();
    view.dispose();
    surface.dispose();
    surface.dispose();
    picker.dispose();
    expect(view.root.parent).toBeNull();
  });
});
