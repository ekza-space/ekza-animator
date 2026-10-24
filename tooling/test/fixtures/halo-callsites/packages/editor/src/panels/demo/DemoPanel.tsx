// Call forms of the run wrappers.
import { PANEL } from '@ekza-studio/editor-core';
import { OpButton } from './OpButton';

const PANEL_KIND = PANEL.graph;
const SETTINGS_OP = 'view.camera.setSettings';

export function DemoPanel(props) {
  const { app, shell, clip, kind, dialog, options, base, playing, ctx } = props;
  void runOperator(app, PANEL_KIND, 'clip.rename', { clip: clip.id, name: props.name });
  void app.run('time.step', { delta: -1 }, ctx);
  void app.run('time.step', { delta: 2.5 });
  void shell.runFromUi('ui.open', { dialog: 'export' });
  void app.runUntyped('edit.undo');
  run('edit.redo', undefined);
  run('prefs.set', { patch: { rigging: { ...props.rigging, jointSize: 2 }, firstRunDone: true, theme: null } });
  run('library.useClip', { ...base, slot: 'idle', loop: false });
  run('ui.open', { dialog });
  run('view.selectionMask', { mask: { [kind]: true } });
  run('file.export', options);
  run(`mesh.create.${kind}`);
  runUntypedOperator(app, PANEL_KIND, SETTINGS_OP, { fovY: 50 });
  run(playing ? 'time.stop' : 'time.play', undefined);
  run('view.frame', { what: 'all' } as const);
  run('view.frame', { what: 'all' });
  runGraphOperator(app, 'graph.tangent.set', { type: 'flat' });
  act(app, clip, 'library.stop', undefined, PANEL_KIND);
  run(props.op, props.args);
  const go = (op: string, args: unknown) => app.runUntyped(op, args);
  go('not.scanned', {});
  // Not sends: polls, shortcuts, translations, non-operator `run` calls.
  app.operators.poll('mesh.bevel', { panel: PANEL_KIND });
  shortcutFor(app.keymap, 'mesh.extrude');
  props.validation.run();
  props.job.run(() => 1);
  return (
    <div>
      <OpButton app={app} op="workspace.showPanel" args={{ panel: PANEL.validation }} />
      <OpButton app={app} op={'view.isolate'} />
      <OpButton app={app} op="edit.repeat" {...props.rest} />
      <OpButton app={app} op={props.op} />
    </div>
  );
}
