// Select on a Validation row (M6B-SPEC §5.21, §8.12; C7): sets the mode and the selection of the row's subject and
// frames it — joints → Skeleton mode and `select.joints`; points → Skin mode, the meshes hilited and their points
// selected (`ComponentSelectionService`, kind `vertex`); meshes → `select.objects`. Then `view.frame {selection}`.
import type { JointId, MeshId } from '@ekza-studio/doc';
import type { EditorApp, RigValidationRow, RunContext } from '../../types';

/** What Select did: the mode it switched to (null: none) and whether it selected anything. */
export interface RowSelection {
  readonly mode: 'skeleton' | 'skin' | null;
  readonly selected: boolean;
}

export async function selectValidationRow(
  app: EditorApp,
  row: Pick<RigValidationRow, 'ids' | 'points'>,
  ctx?: RunContext,
): Promise<RowSelection> {
  const finished = async (op: string, args: unknown): Promise<boolean> =>
    (await app.runUntyped(op, args, ctx)).status === 'finished';
  const frame = async (): Promise<void> => {
    await app.runUntyped('view.frame', { what: 'selection' }, ctx);
  };
  const joints = row.ids.filter((id) => app.store.get('joints', id as JointId) !== undefined) as JointId[];
  if (joints.length > 0) {
    if (app.session.getState().rig.mode !== 'skeleton') await finished('rig.mode', { mode: 'skeleton' });
    const selected = await finished('select.joints', { ids: joints, mode: 'replace' });
    await frame();
    return { mode: 'skeleton', selected };
  }
  const points = Object.entries(row.points ?? {}).filter(
    ([mesh, list]) => list.length > 0 && app.store.get('meshes', mesh as MeshId) !== undefined,
  ) as [MeshId, Uint32Array][];
  if (points.length > 0) {
    if (app.session.getState().rig.mode !== 'skin' && !(await finished('rig.mode', { mode: 'skin' }))) {
      return { mode: null, selected: false };
    }
    const state = app.session.getState();
    app.session.setState({ model: { ...state.model, hilite: points.map(([mesh]) => mesh) } });
    for (const [mesh, list] of points) app.components.apply(mesh, 'vertex', list, 'replace');
    await frame();
    return { mode: 'skin', selected: true };
  }
  const meshes = row.ids.filter((id) => app.store.get('meshes', id as MeshId) !== undefined) as MeshId[];
  if (meshes.length === 0) return { mode: null, selected: false };
  const selected = await finished('select.objects', { ids: meshes, mode: 'replace' });
  await frame();
  return { mode: null, selected };
}
