// The Model operators chunk (M6A-SPEC §5.27; M6A-INT-13, the B0a notes' option C): the definitions, polls and bodies
// of every Model-only operator — the §6.1 kernel ops (B11's registration over B7's wrappers, with the descriptors),
// B10's modes, selection and hide operators, B12a's symmetry, soft-select, snap and pivot operators, B7's and B13's
// creation, template, palette, image-plane and scene operators, B8's Make editable and static export — and the Model
// menu items. It loads on the first Model entry (and with the first run or poll of one of them); until then the
// registry holds the eager proxies of `./modelOps`, built from the generated manifest (`./modelManifest`), which this
// chunk fills in place. Only lazy code and tests import values from it (test/m6a/model-ops.test.ts checks the eager
// side).
import { MESH_OP_DESCRIPTORS, MESH_SET_OP_DESCRIPTORS } from '@ekza-studio/mesh-core/descriptors';
import { CREATE_OPERATORS } from './create';
import type { AnyOperator } from './define';
import { EXPORT_MODEL_OPERATORS } from './exportModel';
import { HIDE_OPERATORS } from './hide';
import { IMAGE_PLANE_OPERATORS } from './imagePlane';
import { MAKE_EDITABLE_OPERATORS } from './makeEditable';
import { MESH_OPERATORS } from './mesh';
import { MODE_OPERATORS } from './mode';
import { MODEL_MENU_ITEMS } from './modelMenus';
import { PALETTE_OPERATORS } from './palette';
import { PIVOT_OPERATORS } from './pivot';
import { SCENE_OPERATORS } from './scene';
import { SELECT_MESH_OPERATORS } from './selectMesh';
import { SNAP_OPERATORS } from './snap';
import { SOFT_SELECT_OPERATORS } from './softSelect';
import { SYMMETRY_OPERATORS } from './symmetry';
import { TEMPLATE_OPERATORS } from './templates';

export { MODEL_MENU_ITEMS };

/**
 * The chunk's operators in their three registration groups (`BUILTIN_OPERATORS` keeps the order it had when every
 * group was eager): the kernel ops; modes, selection, hide, symmetry, soft select, snap and pivots; creation and
 * content.
 */
export const MODEL_OPERATOR_GROUPS = {
  mesh: MESH_OPERATORS,
  select: [
    ...MODE_OPERATORS,
    ...SELECT_MESH_OPERATORS,
    ...HIDE_OPERATORS,
    ...SYMMETRY_OPERATORS,
    ...SOFT_SELECT_OPERATORS,
    ...SNAP_OPERATORS,
    ...PIVOT_OPERATORS,
  ],
  content: [
    ...CREATE_OPERATORS,
    ...TEMPLATE_OPERATORS,
    ...PALETTE_OPERATORS,
    ...IMAGE_PLANE_OPERATORS,
    ...SCENE_OPERATORS,
    ...MAKE_EDITABLE_OPERATORS,
    ...EXPORT_MODEL_OPERATORS,
  ],
} as const satisfies Readonly<Record<string, readonly AnyOperator[]>>;

/** Every operator of the chunk. */
export const MODEL_OPERATORS: readonly AnyOperator[] = [
  ...MODEL_OPERATOR_GROUPS.mesh,
  ...MODEL_OPERATOR_GROUPS.select,
  ...MODEL_OPERATOR_GROUPS.content,
];

/** Kernel ops whose descriptor is object-level (`kinds: 'object'`): their runs read no component kind (§5.7). */
export const OBJECT_LEVEL_MESH_OPS: ReadonlySet<string> = new Set(
  Object.values(MESH_OP_DESCRIPTORS)
    .filter((desc) => desc.kinds === 'object')
    .map((desc) => desc.id),
);

/** The MeshSetOps (§5.13): their LastRun targets are their inputs. */
export const MESH_SET_OPS: ReadonlySet<string> = new Set(Object.keys(MESH_SET_OP_DESCRIPTORS));
