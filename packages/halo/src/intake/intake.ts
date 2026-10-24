// Bring a model (STUDIO-TOUCH-SPEC §9 J1 step 1, §15 rows 11.1–11.3 and 12.2, S10; T11): files from the Files picker
// (no `accept` on iOS) or a drop are read and sniffed by their bytes, never their names, then routed:
//
// - a model (GLB, VRM) or a project (`.ekzanim`) goes through the shared intake of `editor-core/autorigFlow`
//   (`autorig.intake`: Rig & Skin, one import, the heavy-mesh gate and the already-rigged detection; then
//   `routeIntake`): a static model waits in Rig for *Rig it for me ▸*, a VRM or a rigged humanoid is a character to
//   animate, a skinned file the importer cannot map offers *Rig it again from scratch*, a project opens where it was;
// - an animation (`.vrma`) is added to the active character (`file.importAnimation`), or asks for a model first;
// - a glTF text file or a project's debug JSON goes through the host's own pipeline;
// - anything else gets one plain sentence (`UNSUPPORTED_FILE_TEXT`).
//
// On iOS the device's memory profile adds its warning (60k triangles); the 200k refusal is the intake's own. A
// document that already holds something asks first: start a new project (the work stays in autosave) or add to it.
// Every change is an operator run.
import {
  type AutoRigIntakeOutcome,
  chooseFlowCharacter,
  freshDocument,
  intakeFileArgs,
  intakeModel,
  type IntakeReport,
  reRigArgs,
} from '@ekza-studio/editor-core';
import type { HaloStage } from '@ekza-studio/editor-core';
import { type FileKind, memoryProfileOf, nameForKind, sniffFileKind, UNSUPPORTED_FILE_TEXT } from '@ekza-studio/editor/host';
import { en } from '../i18n/en';
import type { HaloController } from '../shell/controller';
import { haloFlowHost } from './flowHost';

/** What one picked file is, read from its bytes. */
export interface SniffedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly kind: FileKind;
}

/** How a sniffed file is taken in. */
export type IntakeRoute = 'model' | 'animation' | 'host' | 'unsupported';

export function routeOf(kind: FileKind): IntakeRoute {
  switch (kind) {
    case 'glb':
    case 'vrm':
    case 'project':
      return 'model';
    case 'vrma':
      return 'animation';
    case 'gltf':
    case 'projectJson':
      return 'host';
    default:
      return 'unsupported';
  }
}

/**
 * The stage a finished intake continues in (§9 J1): a static model waits in Rig for *Rig it for me*, a VRM or a rigged
 * humanoid is animated, a project opens in Animate when it holds a character and in Make when it holds only meshes.
 */
export function stageAfter(
  report: IntakeReport,
  outcome: AutoRigIntakeOutcome & { readonly status: 'finished' },
  characters: number,
): HaloStage {
  if (outcome.route.kind === 'animations') return 'animate';
  if (report.kind === 'project') return characters > 0 ? 'animate' : 'make';
  return 'rig';
}

/** Reads and sniffs the picked files (S10: the bytes decide, the name only follows them). */
export async function sniffFiles(files: readonly File[]): Promise<SniffedFile[]> {
  return Promise.all(
    files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = sniffFileKind(bytes);
      return { name: nameForKind(file.name, kind), bytes, kind };
    }),
  );
}

const hasContent = (controller: HaloController): boolean => {
  const { app } = controller.ctx;
  return app.store.list('characters').length > 0 || app.store.list('meshes').length > 0;
};

export interface BringOptions {
  /** The New question of a document that holds something (§9 J1 assumes a fresh one): true starts a new project. */
  readonly ask: () => Promise<'new' | 'add' | 'cancel'>;
  /** Called once something came in (Home gives way to the canvas). */
  readonly done?: () => void;
}

/** Takes the files in (Home › Bring a model, the project menu's Open and Import, a drop on Home). */
export async function bringFiles(
  controller: HaloController,
  files: readonly File[],
  options: BringOptions,
): Promise<boolean> {
  const { ctx } = controller;
  const toast = (text: string, tone: 'warning' | 'error' = 'error'): void => {
    ctx.toasts.push({ key: 'intake', text, tone });
  };
  const sniffed = await sniffFiles(files);
  let took = false;
  let asked = false;
  for (const file of sniffed) {
    const route = routeOf(file.kind);
    if (route === 'unsupported') {
      toast(UNSUPPORTED_FILE_TEXT);
      continue;
    }
    if (route === 'animation') {
      const character = ctx.app.session.getState().activeCharacter ?? ctx.app.store.list('characters')[0]?.id;
      if (character === undefined) {
        toast(en.intake.animationFirst, 'warning');
        continue;
      }
      const result = await ctx.run('file.importAnimation', { name: file.name, bytes: file.bytes, character });
      if (result.status === 'finished') {
        took = true;
        await controller.enterStage('animate');
      }
      continue;
    }
    if (route === 'host') {
      await ctx.host.files.openFiles([new File([file.bytes as BlobPart], file.name)]);
      took = hasContent(controller) || took;
      continue;
    }
    // a model or a project: the shared intake (Rig & Skin, one import, the routing)
    const host = haloFlowHost(ctx);
    if (!asked && hasContent(controller)) {
      asked = true;
      const answer = await options.ask();
      if (answer === 'cancel') return took;
      if (answer === 'new' && !(await freshDocument(host, () => Promise.resolve(true)))) return took;
    }
    const outcome = await intakeModel(host, 'autorig.intake', intakeFileArgs(file.name, file.bytes));
    if (outcome.status === 'failed') {
      toast(outcome.error);
      continue;
    }
    took = true;
    const report = outcome.report;
    // §15.0, S8: the iPad's memory profile warns about heavy models (the intake itself refuses above 200k)
    const triangles = memoryProfileOf(ctx.host).triangles;
    if (triangles !== null && report.triangles > triangles.warn) {
      toast(en.intake.heavy(report.triangles), 'warning');
    }
    if (outcome.route.kind === 'rerig') {
      ctx.toasts.push({
        key: 'intake',
        text: en.intake.rerig,
        tone: 'warning',
        durationMs: Number.POSITIVE_INFINITY,
        action: {
          label: en.intake.rerigAction,
          run: () => {
            void intakeModel(host, 'autorig.intake', reRigArgs({ name: file.name, bytes: file.bytes })).then(
              (again) => {
                if (again.status === 'finished') void controller.enterStage('rig');
                else toast(again.error);
              },
            );
          },
        },
      });
      await controller.enterStage('rig');
      continue;
    }
    if (outcome.route.kind === 'choose') {
      const first = outcome.route.characters[0];
      if (first !== undefined) chooseFlowCharacter(host, first);
      toast(en.intake.choose(outcome.route.characters.length), 'warning');
    }
    await controller.enterStage(stageAfter(report, outcome, ctx.app.store.list('characters').length));
  }
  if (took) options.done?.();
  return took;
}
