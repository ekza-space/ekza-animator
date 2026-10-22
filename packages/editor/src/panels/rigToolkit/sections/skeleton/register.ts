// The skeleton UI's shell parts (M6B-SPEC §5.7, §5.17; C3), registered with the lazy Rig & Skin shell UI: the
// `FK FOR TEST` viewport badge — shown while the active character's test pose switches an IK limb to FK (`E` on a
// joint of an IK limb writes `@ikFk` = 0 into the test pose, never a key).
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp, ViewportBadgeProvider } from '@ekza-studio/editor-core';
import { registerViewportBadge } from '../../../viewport/hud/badges';

export const FK_FOR_TEST = 'FK FOR TEST';

/** Whether the active character's test pose holds an IK limb in FK (`@ikFk` = 0) in the Test view. */
export function fkForTest(app: EditorApp): boolean {
  const state = app.session.getState();
  const character = state.rig.character;
  if (state.workspace !== 'rig' || state.rig.poseView !== 'test' || character === null || !app.rig.loaded) return false;
  for (const [control, values] of app.rig.testPose.values(character)) {
    if (values['@ikFk'] !== 0) continue;
    const record = app.store.get('controls', control);
    if (record !== undefined && Object.hasOwn(record.attrs, 'ikFk')) return true;
  }
  return false;
}

export function fkTestBadge(app: EditorApp): ViewportBadgeProvider {
  return {
    id: 'fkTest',
    label: (target) => (fkForTest(target) ? FK_FOR_TEST : null),
    subscribe: (listener) => {
      let offPose: Disposer | null = null;
      const attach = (): void => {
        if (offPose === null && app.rig.loaded) offPose = app.rig.testPose.subscribe(() => listener());
      };
      attach();
      const offSession = app.session.subscribe((state, previous) => {
        attach();
        if (
          state.workspace !== previous.workspace ||
          state.rig.poseView !== previous.rig.poseView ||
          state.rig.character !== previous.rig.character
        ) {
          listener();
        }
      });
      return () => {
        offSession();
        offPose?.();
      };
    },
  };
}

/** Registers the skeleton UI's shell parts; the disposer removes them. */
export function registerSkeletonUi(app: EditorApp): Disposer {
  return registerViewportBadge(fkTestBadge(app));
}
