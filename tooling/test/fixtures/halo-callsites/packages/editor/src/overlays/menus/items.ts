// Descriptor tables: `op:` objects, the marking-menu factory and menu rows.
const op = (op: string, label?: string, args?: unknown) => ({
  op,
  ...(label === undefined ? {} : { label }),
  ...(args === undefined ? {} : { args }),
});
const create = (kind: string, label: string) => ({ op: `mesh.create.${kind}`, label });
const MODE_ARGS = { mode: 'vertex' };

export const MENU = {
  slots: {
    N: op('mesh.extrude', 'Extrude'),
    S: op('mesh.freezeTransforms', 'Freeze', { translate: true, rotate: false }),
    E: create('cube', 'Cube'),
  },
  list: [
    { id: 'about', op: 'ui.open', args: { dialog: 'about' } },
    { id: 'isolate', op: 'view.isolate' },
    { id: 'focus', op: 'workspace.toggleFocus', ...(props.state === undefined ? {} : { checked: () => true }) },
    { id: 'tool', op: 'view.tool', ...(props.args === undefined ? {} : { args: props.args }) },
    { id: 'mode', op: 'select.mode', args: MODE_ARGS },
    { id: 'brush', op: 'replace', label: 'Replace' },
    { id: 'dynamic', op: props.item.op },
  ],
};

type Row = readonly [string, string, unknown?, string?];
export const ROWS: readonly Row[] = [
  ['xray', 'view.display.toggle', { flag: 'xrayJoints' }, 'X-Ray Joints'],
  ['thumb', 'char.renderThumbnail', undefined, 'Render Thumbnail'],
];
// Not rows: a list of rule ids and a two-element poll tuple.
export const RULES = ['skel.tpose', 'skin.bind', 'skin.unbound'];
export const POLLS = [['rig.mode', { mode: 'object' }]];
