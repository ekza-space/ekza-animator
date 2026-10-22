// M6b test API, C7 group (M6B-SPEC §4.8, §0.5): the Rig & Skin state (mode, pose view, active character, test pose,
// the MVP checklist and the tab glyph), the Validation rows per profile and the rig program compile count.
import { type EditorApp, rigValidation } from '@ekza-studio/editor-core';
import type { EkzaStudioTestApi } from '../types';
import type { M6bTestApiContext } from './support';

export type RigShellTestApi = Pick<EkzaStudioTestApi, 'rigState' | 'validation' | 'rigCompiles'>;

/** Program compiles per character since the test API started: 1 when added, +1 per recompile. */
function compileCounter(app: EditorApp): (character: string) => number {
  const counts = new Map<string, number>();
  for (const runtime of app.characters.list()) counts.set(runtime.id, 1);
  app.characters.subscribe((event) => {
    if (event.type === 'added' || event.type === 'recompiled') counts.set(event.id, (counts.get(event.id) ?? 0) + 1);
  });
  return (character) => counts.get(character) ?? 0;
}

export function rigShellTestApi(ctx: M6bTestApiContext): RigShellTestApi {
  const app = ctx.shell.app;
  const compiles = compileCounter(app);
  return {
    rigState() {
      ctx.sync();
      const { rig } = app.session.getState();
      if (!app.rig.loaded) {
        void app.rig.load();
        return {
          mode: rig.mode,
          poseView: rig.poseView,
          character: rig.character,
          testPose: { controls: 0, version: 0 },
          checklist: [],
          glyph: 'todo',
        };
      }
      const validation = rigValidation(app);
      const character = rig.character;
      const steps = validation.checklist(character);
      return {
        mode: rig.mode,
        poseView: rig.poseView,
        character,
        testPose: {
          controls: character === null ? 0 : app.rig.testPose.values(character).size,
          version: app.rig.testPose.version,
        },
        checklist: steps.map((step) => ({ step: step.step, glyph: step.glyph })),
        glyph: character === null ? 'todo' : validation.status(character, null).glyph,
      };
    },
    validation(profile) {
      ctx.sync();
      const character = app.session.getState().rig.character;
      if (character === null || !app.rig.loaded) return [];
      return rigValidation(app)
        .rows(character, profile ?? null)
        .map((row) => ({
          code: row.code,
          severity: row.severity,
          message: row.message,
          count:
            row.points === undefined
              ? row.ids.length
              : Object.values(row.points).reduce((sum, points) => sum + points.length, 0),
          fix: row.fix?.op ?? null,
        }));
    },
    rigCompiles: (character) => compiles(character),
  };
}
