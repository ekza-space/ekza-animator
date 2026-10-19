// M6A-SPEC §6.1, §8.6, research 16 U-2 (B11): every `mesh.*` op is registered from its descriptor through
// `meshOperator` / `meshSetOperator` (label, params, flags, pass-through args, Model workspace, tools, aliases,
// internal ops), and every op renders a Last-op card from its params or none: the card's fields are the visible params
// (primary first), each default displays and parses back to itself.
import { coerceArgs, isNumericParam, type ParamDef } from '@ekza-animator/anim-core';
import { MESH_OP_DESCRIPTORS, MESH_SET_OP_DESCRIPTORS } from '@ekza-animator/mesh-core/descriptors';
import { describe, expect, it } from 'vitest';
import {
  formatParamValue,
  INTERNAL_MESH_OPS,
  MESH_OP_ALIASES,
  MESH_OP_TOOLS,
  parseParamInput,
  visibleParams,
} from '../../src';
import { BUILTIN_OPERATORS } from '../../src/operators/builtin';

const byId = new Map<string, (typeof BUILTIN_OPERATORS)[number]>(BUILTIN_OPERATORS.map((def) => [def.id, def]));
const DESCRIPTORS = [...Object.values(MESH_OP_DESCRIPTORS), ...Object.values(MESH_SET_OP_DESCRIPTORS)];

describe('mesh operator registration (§6.1)', () => {
  it('registers every kernel op and set-op from its descriptor', () => {
    expect(DESCRIPTORS).toHaveLength(42);
    for (const desc of DESCRIPTORS) {
      const def = byId.get(desc.id);
      expect(def).toMatchObject({
        id: desc.id,
        label: desc.label,
        category: 'mesh',
        scope: 'model',
        workspaces: ['model'],
        extraArgs: ['meshes', 'kind'],
        flags: { undo: true, adjustable: desc.flags.adjustable, repeatable: desc.flags.repeatable },
      });
      expect([typeof def?.description, typeof def?.poll]).toEqual(['string', 'function']);
      expect(def?.params).toBe(desc.params);
      expect([desc.id, def?.flags?.internal === true]).toEqual([desc.id, INTERNAL_MESH_OPS.has(desc.id)]);
    }
  });

  it("tools: G after a tool run and Y re-activate the op's tool (§5.7)", () => {
    expect(MESH_OP_TOOLS).toEqual({
      'mesh.insertLoop': 'insertLoop',
      'mesh.cut': 'multiCut',
      'mesh.slide': 'slide',
      'mesh.targetWeld': 'targetWeld',
      'mesh.paint': 'paint',
      'mesh.paint.fillShell': 'paint',
    });
    const tools = Object.fromEntries(Object.keys(MESH_OP_TOOLS).map((id) => [id, byId.get(id)?.tool]));
    expect(tools).toEqual(MESH_OP_TOOLS);
    expect(byId.get('mesh.extrude')?.tool).toBeUndefined(); // §5.7 rule 1: the extrude declares no tool
  });

  it('aliases: Blender names for the command palette', () => {
    expect(byId.get('mesh.insertLoop')?.aliases).toContain('Loop Cut');
    expect(byId.get('mesh.cut')?.aliases).toContain('Knife');
    expect(byId.get('mesh.mergeByDistance')?.aliases).toContain('Remove Doubles');
    expect(byId.get('mesh.combine')?.aliases).toContain('Join');
    expect(Object.keys(MESH_OP_ALIASES).filter((id) => !byId.has(id))).toEqual([]);
  });

  it('internal ops are run by other operators only', () => {
    expect([...INTERNAL_MESH_OPS].sort()).toEqual(['mesh.applyTransform', 'mesh.paint.remap']);
  });
});

describe('card generation from params (§8.6)', () => {
  const cards = DESCRIPTORS.map((desc) => ({ desc, fields: visibleParams(desc.params) }));

  it('every op renders a card or none; paramless and pointer-only ops render none', () => {
    const none = cards.filter((c) => c.fields.length === 0).map((c) => c.desc.id);
    expect(none).toEqual(
      expect.arrayContaining([
        'mesh.fillHole',
        'mesh.delete',
        'mesh.deleteEdgeVertex',
        'mesh.mergeToCenter',
        'mesh.collapse',
        'mesh.triangulate',
        'mesh.harden',
        'mesh.soften',
        'mesh.reverse',
        'mesh.conform',
        'mesh.cut',
        'mesh.separate',
        'mesh.applyTransform',
      ]),
    );
    // An adjustable op has something to adjust (its card is never empty); no hidden, data or bound field is shown.
    expect(cards.filter((c) => c.desc.flags.adjustable && c.fields.length === 0).map((c) => c.desc.id)).toEqual([]);
    const shownWrongly = cards.flatMap((c) =>
      c.fields
        .filter((f) => f.hidden === true || f.kind === 'data' || f.bound !== 'value')
        .map((f) => `${c.desc.id}.${f.name}`),
    );
    expect(shownWrongly).toEqual([]);
  });

  it('the primary field comes first and is numeric or an enum where it exists (typed digits go there)', () => {
    const problems: string[] = [];
    for (const { desc, fields } of cards) {
      const primary = desc.params.find((p: ParamDef) => p.primary === true && p.hidden !== true && p.bound === 'value');
      if (primary === undefined) continue;
      if (fields[0]?.name !== primary.name) problems.push(`${desc.id}: primary not first`);
      if (!isNumericParam(primary) && primary.kind !== 'enum') problems.push(`${desc.id}: primary ${primary.kind}`);
    }
    expect(problems).toEqual([]);
  });

  it('each field default displays and parses back to itself (the card starts on what the op ran with)', () => {
    const problems: string[] = [];
    for (const { desc, fields } of cards) {
      for (const field of fields) {
        const where = `${desc.id}.${field.name}`;
        const text = formatParamValue(field, field.default, { unit: false });
        const parsed = parseParamInput(text, field.default, field);
        if ('error' in parsed) {
          problems.push(`${where} "${text}": ${parsed.error}`);
          continue;
        }
        const value = parsed.value;
        const tolerance = field.kind === 'angle' ? 1e-5 : 1e-3;
        const same =
          typeof field.default === 'number' && typeof value === 'number'
            ? Math.abs(value - field.default) <= tolerance
            : value === field.default;
        if (!same) problems.push(`${where}: ${JSON.stringify(value)} ≠ ${JSON.stringify(field.default)}`);
        const coerced = coerceArgs([field], { [field.name]: value }).problems;
        if (coerced.length > 0) problems.push(`${where}: ${coerced.join('; ')}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
