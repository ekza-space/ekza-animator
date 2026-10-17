// Input budgets and structural checks for untrusted GLB/VRM files (MVP-SPEC §4.11.14, ARCHITECTURE §16). Everything
// here reads the JSON and at most the sparse index bytes; nothing allocates in proportion to accessor counts, so a
// hostile file is rejected before any large allocation. Errors (`budget-exceeded`, `malformed-gltf`) abort the import;
// warnings describe tolerable deviations.
import { readGlbLayout } from '../glb/parse';
import {
  accessorsOf,
  animationsOf,
  buffersOf,
  bufferViewsOf,
  COMPONENT_SIZE,
  elementSize,
  type GltfAccessorDef,
  type GltfBufferViewDef,
  isIndex,
  isRecord,
  type JsonRecord,
  listField,
  meshesOf,
  MESHOPT_EXTENSIONS,
  meshoptOf,
  nodesOf,
  packedElementSize,
  pointer,
  scenesOf,
  skinsOf,
  TYPE_COMPONENTS,
} from '../gltf/schema';
import { DEFAULT_INPUT_BUDGET, type GlbContainer, type InputBudget, type LintIssue } from '../types';

/** At most this many issues are reported (a hostile file could otherwise produce millions). */
export const MAX_BUDGET_ISSUES = 200;

const INTERPOLATIONS = new Set(['LINEAR', 'STEP', 'CUBICSPLINE']);
const INDEX_COMPONENT_TYPES = new Set([5121, 5123, 5125]);

class Issues {
  readonly list: LintIssue[] = [];
  private dropped = 0;

  error(code: 'budget-exceeded' | 'malformed-gltf', message: string, at?: string): void {
    this.push({ code, severity: 'error', message, ...(at === undefined ? {} : { pointer: at }) });
  }

  warn(message: string, at?: string): void {
    this.push({ code: 'malformed-gltf', severity: 'warning', message, ...(at === undefined ? {} : { pointer: at }) });
  }

  private push(issue: LintIssue): void {
    if (this.list.length < MAX_BUDGET_ISSUES) this.list.push(issue);
    else this.dropped++;
  }

  finish(): readonly LintIssue[] {
    if (this.dropped > 0) {
      this.list.push({
        code: 'malformed-gltf',
        severity: this.list.some((i) => i.severity === 'error') ? 'error' : 'warning',
        message: `${this.dropped} more issues were not listed`,
      });
    }
    return this.list;
  }
}

/** Budgets + structure (§4.11.14). An empty list or warnings only means the file may be read. */
export function checkInputBudget(c: GlbContainer, budget: InputBudget = DEFAULT_INPUT_BUDGET): readonly LintIssue[] {
  const issues = new Issues();
  const json = c.json;
  const size = c.bytes.byteLength;
  if (size > budget.maxFileBytes) {
    issues.error('budget-exceeded', `The file is ${size} bytes; the limit is ${budget.maxFileBytes}`);
  }
  if (c.jsonByteLength > budget.maxJsonBytes) {
    issues.error('budget-exceeded', `The JSON chunk is ${c.jsonByteLength} bytes; the limit is ${budget.maxJsonBytes}`);
  }
  checkLayout(c, issues);

  const nodes = nodesOf(json);
  if (nodes.length > budget.maxNodes) {
    issues.error('budget-exceeded', `The file has ${nodes.length} nodes; the limit is ${budget.maxNodes}`, '/nodes');
  }

  const buffers = buffersOf(json);
  const bufferLengths = checkBuffers(c, issues);
  const views = bufferViewsOf(json);
  views.forEach((view, i) => checkBufferView(view, i, bufferLengths, buffers.length, issues));
  checkAccessors(c, views, budget, issues);
  checkNodes(json, nodes.length, issues);
  checkMeshes(json, issues);
  checkSkins(json, nodes.length, issues);
  checkAnimations(json, nodes.length, issues);
  return issues.finish();
}

function checkLayout(c: GlbContainer, issues: Issues): void {
  const layout = readGlbLayout(c.bytes);
  if (layout.declaredLength !== c.bytes.byteLength) {
    issues.error(
      'malformed-gltf',
      `The GLB header declares ${layout.declaredLength} bytes but the file has ${c.bytes.byteLength}`,
    );
  }
  if (layout.truncated) issues.error('malformed-gltf', 'A GLB chunk extends past the end of the file');
  if (layout.trailingBytes > 0) {
    issues.error('malformed-gltf', `${layout.trailingBytes} bytes after the last GLB chunk do not form a chunk`);
  }
  for (const chunk of layout.chunks) {
    if (chunk.length % 4 !== 0 || chunk.offset % 4 !== 0) {
      issues.warn(`A GLB chunk of ${chunk.length} bytes is not 4-byte aligned`);
    }
  }
  const binChunks = layout.chunks.filter((chunk) => chunk.type === 0x004e4942).length;
  if (binChunks > 1) issues.warn(`The GLB has ${binChunks} BIN chunks; only the first is used`);
}

/** Usable byte length of each buffer (−1 when the buffer cannot be read). */
function checkBuffers(c: GlbContainer, issues: Issues): number[] {
  return buffersOf(c.json).map((buffer, i) => {
    const at = pointer('buffers', i);
    if (!isIndex(buffer.byteLength) || buffer.byteLength < 1) {
      issues.error('malformed-gltf', `buffers[${i}].byteLength is not a positive integer`, `${at}/byteLength`);
      return -1;
    }
    if (buffer.uri !== undefined) {
      if (typeof buffer.uri !== 'string' || !/^data:[^,]*;base64,/i.test(buffer.uri)) {
        issues.error(
          'malformed-gltf',
          `buffers[${i}] references an external file (only GLB is supported)`,
          `${at}/uri`,
        );
        return -1;
      }
      return buffer.byteLength;
    }
    const ext = buffer.extensions;
    const fallback = isRecord(ext) && MESHOPT_EXTENSIONS.some((n) => isRecord(ext[n]) && ext[n]['fallback'] === true);
    if (fallback) return buffer.byteLength;
    if (i !== 0) {
      issues.error('malformed-gltf', `buffers[${i}] has no uri; only buffers[0] may use the GLB BIN chunk`, at);
      return -1;
    }
    if (c.bin === null) {
      issues.error('malformed-gltf', 'buffers[0] has no uri but the GLB has no BIN chunk', at);
      return -1;
    }
    if (buffer.byteLength > c.bin.byteLength) {
      issues.error(
        'malformed-gltf',
        `buffers[0].byteLength (${buffer.byteLength}) exceeds the BIN chunk (${c.bin.byteLength} bytes)`,
        `${at}/byteLength`,
      );
      return -1;
    }
    if (c.bin.byteLength - buffer.byteLength > 3) {
      issues.warn(`The BIN chunk is ${c.bin.byteLength - buffer.byteLength} bytes longer than buffers[0]`, at);
    }
    return buffer.byteLength;
  });
}

function checkBufferView(
  view: GltfBufferViewDef,
  i: number,
  bufferLengths: readonly number[],
  bufferCount: number,
  issues: Issues,
): void {
  const at = pointer('bufferViews', i);
  if (!isIndex(view.buffer) || view.buffer >= bufferCount) {
    issues.error('malformed-gltf', `bufferViews[${i}] references a missing buffer`, `${at}/buffer`);
    return;
  }
  const offset = view.byteOffset ?? 0;
  if (!isIndex(offset) || !isIndex(view.byteLength) || view.byteLength < 1) {
    issues.error('malformed-gltf', `bufferViews[${i}] has an invalid byteOffset or byteLength`, at);
    return;
  }
  const bufferLength = bufferLengths[view.buffer] ?? -1;
  if (bufferLength >= 0 && offset + view.byteLength > bufferLength) {
    issues.error('malformed-gltf', `bufferViews[${i}] exceeds buffers[${view.buffer}]`, at);
  }
  if (
    view.byteStride !== undefined &&
    (!isIndex(view.byteStride) || view.byteStride < 4 || view.byteStride > 252 || view.byteStride % 4 !== 0)
  ) {
    issues.error(
      'malformed-gltf',
      `bufferViews[${i}].byteStride must be a multiple of 4 in 4..252`,
      `${at}/byteStride`,
    );
  }
  const meshopt = meshoptOf(view);
  if (meshopt !== null) {
    const source = meshopt.buffer;
    const sourceOffset = meshopt.byteOffset ?? 0;
    if (!isIndex(source) || source >= bufferCount || !isIndex(sourceOffset) || !isIndex(meshopt.byteLength)) {
      issues.error('malformed-gltf', `bufferViews[${i}] has an invalid meshopt source`, `${at}/extensions`);
      return;
    }
    const sourceLength = bufferLengths[source] ?? -1;
    if (sourceLength >= 0 && sourceOffset + meshopt.byteLength > sourceLength) {
      issues.error(
        'malformed-gltf',
        `The meshopt data of bufferViews[${i}] exceeds buffers[${source}]`,
        `${at}/extensions`,
      );
    }
    if (
      !isIndex(meshopt.count) ||
      !isIndex(meshopt.byteStride) ||
      meshopt.count * meshopt.byteStride > view.byteLength
    ) {
      issues.error(
        'malformed-gltf',
        `The meshopt count/byteStride of bufferViews[${i}] exceed its byteLength`,
        `${at}/extensions`,
      );
    }
  }
}

function checkAccessors(
  c: GlbContainer,
  views: readonly GltfBufferViewDef[],
  budget: InputBudget,
  issues: Issues,
): void {
  const accessors = accessorsOf(c.json);
  let totalCount = 0;
  let decodedBytes = 0;
  accessors.forEach((accessor, i) => {
    const at = pointer('accessors', i);
    const components = TYPE_COMPONENTS[accessor.type];
    const componentSize = COMPONENT_SIZE[accessor.componentType];
    if (components === undefined || componentSize === undefined) {
      issues.error('malformed-gltf', `accessors[${i}] has an unknown type or componentType`, at);
      return;
    }
    if (!isIndex(accessor.count)) {
      issues.error('malformed-gltf', `accessors[${i}].count is not a non-negative integer`, `${at}/count`);
      return;
    }
    if (accessor.count > budget.maxAccessorCount) {
      issues.error(
        'budget-exceeded',
        `accessors[${i}].count is ${accessor.count}; the limit is ${budget.maxAccessorCount}`,
        `${at}/count`,
      );
    }
    totalCount += accessor.count;
    decodedBytes += accessor.count * components * componentSize;
    if (accessor.bufferView !== undefined) checkAccessorExtent(accessor, i, views, issues);
    const sparse = accessor.sparse;
    if (sparse !== undefined) {
      if (!isRecord(sparse) || !isIndex(sparse.count) || sparse.count > accessor.count) {
        issues.error('malformed-gltf', `accessors[${i}].sparse.count exceeds the accessor count`, `${at}/sparse/count`);
        return;
      }
      totalCount += sparse.count;
      decodedBytes += sparse.count * components * componentSize;
      if (accessor.count <= budget.maxAccessorCount) checkSparse(c, accessor, i, views, issues);
    }
  });
  if (totalCount > budget.maxTotalAccessorCount) {
    issues.error(
      'budget-exceeded',
      `The accessors hold ${totalCount} elements in total; the limit is ${budget.maxTotalAccessorCount}`,
      '/accessors',
    );
  }
  if (decodedBytes > budget.maxDecodedBytes) {
    issues.error(
      'budget-exceeded',
      `Decoding the accessors needs ${decodedBytes} bytes; the limit is ${budget.maxDecodedBytes}`,
      '/accessors',
    );
  }
}

function checkAccessorExtent(
  accessor: GltfAccessorDef,
  i: number,
  views: readonly GltfBufferViewDef[],
  issues: Issues,
): void {
  const at = pointer('accessors', i);
  const view = isIndex(accessor.bufferView) ? views[accessor.bufferView] : undefined;
  if (view === undefined) {
    issues.error('malformed-gltf', `accessors[${i}] references a missing bufferView`, `${at}/bufferView`);
    return;
  }
  const size = packedElementSize(accessor) ?? 0;
  const stride = view.byteStride ?? size;
  const offset = accessor.byteOffset ?? 0;
  if (!isIndex(offset)) {
    issues.error('malformed-gltf', `accessors[${i}].byteOffset is invalid`, `${at}/byteOffset`);
    return;
  }
  if (accessor.count > 0 && offset + stride * (accessor.count - 1) + size > view.byteLength) {
    issues.error(
      'malformed-gltf',
      `accessors[${i}] (count ${accessor.count}) reads past the end of bufferViews[${accessor.bufferView}]`,
      at,
    );
  }
}

function checkSparse(
  c: GlbContainer,
  accessor: GltfAccessorDef,
  i: number,
  views: readonly GltfBufferViewDef[],
  issues: Issues,
): void {
  const sparse = accessor.sparse as NonNullable<GltfAccessorDef['sparse']>;
  const at = pointer('accessors', i, 'sparse');
  const indices = sparse.indices;
  const values = sparse.values;
  if (!isRecord(indices) || !isRecord(values) || !INDEX_COMPONENT_TYPES.has(indices.componentType)) {
    issues.error('malformed-gltf', `accessors[${i}].sparse has invalid indices or values`, at);
    return;
  }
  const indexSize = COMPONENT_SIZE[indices.componentType] as number;
  const indexView = isIndex(indices.bufferView) ? views[indices.bufferView] : undefined;
  const valueView = isIndex(values.bufferView) ? views[values.bufferView] : undefined;
  const indexOffset = indices.byteOffset ?? 0;
  const valueOffset = values.byteOffset ?? 0;
  if (indexView === undefined || valueView === undefined || !isIndex(indexOffset) || !isIndex(valueOffset)) {
    issues.error('malformed-gltf', `accessors[${i}].sparse references a missing bufferView`, at);
    return;
  }
  if (indexOffset + sparse.count * indexSize > indexView.byteLength) {
    issues.error('malformed-gltf', `accessors[${i}].sparse.indices exceed their bufferView`, `${at}/indices`);
    return;
  }
  if (valueOffset + sparse.count * (elementSize(accessor) ?? 0) > valueView.byteLength) {
    issues.error('malformed-gltf', `accessors[${i}].sparse.values exceed their bufferView`, `${at}/values`);
  }
  // Index values: read in place when the bytes are directly available (embedded BIN, not compressed).
  if (meshoptOf(indexView) !== null || indexView.buffer !== 0 || c.bin === null) return;
  const buffer0 = buffersOf(c.json)[0];
  if (buffer0 === undefined || buffer0.uri !== undefined) return;
  const start = (indexView.byteOffset ?? 0) + indexOffset;
  if (start + sparse.count * indexSize > c.bin.byteLength) return;
  const dv = new DataView(c.bin.buffer, c.bin.byteOffset + start, sparse.count * indexSize);
  for (let k = 0; k < sparse.count; k++) {
    const index =
      indexSize === 1 ? dv.getUint8(k) : indexSize === 2 ? dv.getUint16(k * 2, true) : dv.getUint32(k * 4, true);
    if (index >= accessor.count) {
      issues.error(
        'malformed-gltf',
        `accessors[${i}].sparse index ${index} is not below count ${accessor.count}`,
        `${at}/indices`,
      );
      return;
    }
  }
}

function checkNodes(json: JsonRecord, nodeCount: number, issues: Issues): void {
  const nodes = nodesOf(json);
  const parent = new Int32Array(nodeCount).fill(-1);
  const counts = {
    meshes: listLength(json, 'meshes'),
    skins: listLength(json, 'skins'),
    cameras: listLength(json, 'cameras'),
  };
  nodes.forEach((node, i) => {
    const at = pointer('nodes', i);
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) {
        issues.error('malformed-gltf', `nodes[${i}].children is not an array`, `${at}/children`);
      } else {
        for (const child of node.children) {
          if (!isIndex(child) || child >= nodeCount) {
            issues.error(
              'malformed-gltf',
              `nodes[${i}] has a child that does not exist (${String(child)})`,
              `${at}/children`,
            );
          } else if (child === i) {
            issues.error('malformed-gltf', `nodes[${i}] is its own child`, `${at}/children`);
          } else if (parent[child] !== -1) {
            issues.error('malformed-gltf', `nodes[${child}] has more than one parent`, `${at}/children`);
          } else {
            parent[child] = i;
          }
        }
      }
    }
    for (const key of ['mesh', 'skin', 'camera'] as const) {
      const ref = node[key];
      const limit = key === 'mesh' ? counts.meshes : key === 'skin' ? counts.skins : counts.cameras;
      if (ref !== undefined && (!isIndex(ref) || ref >= limit)) {
        issues.error('malformed-gltf', `nodes[${i}].${key} references a missing ${key}`, `${at}/${key}`);
      }
    }
  });
  // With at most one parent per node, a node is on a cycle iff following parents never reaches a root.
  const state = new Uint8Array(nodeCount); // 0 unknown, 1 on the current walk, 2 reaches a root
  for (let start = 0; start < nodeCount; start++) {
    if (state[start] !== 0) continue;
    const walk: number[] = [];
    let n = start;
    while (n !== -1 && state[n] === 0) {
      state[n] = 1;
      walk.push(n);
      n = parent[n] as number;
    }
    const cyclic = n !== -1 && state[n] === 1;
    for (const w of walk) state[w] = 2;
    if (cyclic) {
      issues.error('malformed-gltf', `The node hierarchy has a cycle through nodes[${n}]`, pointer('nodes', n));
    }
  }
  scenesOf(json).forEach((scene, i) => {
    for (const root of listField(scene.nodes)) {
      if (!isIndex(root) || root >= nodeCount) {
        issues.error('malformed-gltf', `scenes[${i}] references a missing node`, pointer('scenes', i, 'nodes'));
      }
    }
  });
  const scene = json['scene'];
  if (scene !== undefined && (!isIndex(scene) || scene >= listLength(json, 'scenes'))) {
    issues.error('malformed-gltf', 'The default scene does not exist', '/scene');
  }
}

function checkMeshes(json: JsonRecord, issues: Issues): void {
  const accessorCount = listLength(json, 'accessors');
  const materialCount = listLength(json, 'materials');
  const validAccessor = (ref: unknown): boolean => isIndex(ref) && ref < accessorCount;
  meshesOf(json).forEach((mesh, m) => {
    const primitives = listField(mesh.primitives);
    primitives.forEach((primitive, p) => {
      const at = pointer('meshes', m, 'primitives', p);
      if (!isRecord(primitive) || !isRecord(primitive.attributes)) {
        issues.error('malformed-gltf', `meshes[${m}].primitives[${p}] has no attributes`, at);
        return;
      }
      for (const [name, ref] of Object.entries(primitive.attributes)) {
        if (!validAccessor(ref))
          issues.error('malformed-gltf', `Attribute ${name} references a missing accessor`, `${at}/attributes`);
      }
      if (primitive.indices !== undefined && !validAccessor(primitive.indices)) {
        issues.error(
          'malformed-gltf',
          `meshes[${m}].primitives[${p}].indices references a missing accessor`,
          `${at}/indices`,
        );
      }
      if (primitive.material !== undefined && (!isIndex(primitive.material) || primitive.material >= materialCount)) {
        issues.error('malformed-gltf', `meshes[${m}].primitives[${p}].material does not exist`, `${at}/material`);
      }
      const targets = listField(primitive.targets);
      targets.forEach((target, t) => {
        for (const ref of Object.values(isRecord(target) ? target : {})) {
          if (!validAccessor(ref)) {
            issues.error('malformed-gltf', `Morph target ${t} references a missing accessor`, `${at}/targets/${t}`);
          }
        }
      });
    });
  });
}

function checkSkins(json: JsonRecord, nodeCount: number, issues: Issues): void {
  const accessors = accessorsOf(json);
  skinsOf(json).forEach((skin, s) => {
    const at = pointer('skins', s);
    const joints = Array.isArray(skin.joints) ? skin.joints : null;
    if (joints === null || joints.length === 0) {
      issues.error('malformed-gltf', `skins[${s}] has no joints`, `${at}/joints`);
      return;
    }
    if (joints.some((joint) => !isIndex(joint) || joint >= nodeCount)) {
      issues.error('malformed-gltf', `skins[${s}] has a joint that does not exist`, `${at}/joints`);
    }
    if (skin.skeleton !== undefined && (!isIndex(skin.skeleton) || skin.skeleton >= nodeCount)) {
      issues.error('malformed-gltf', `skins[${s}].skeleton does not exist`, `${at}/skeleton`);
    }
    if (skin.inverseBindMatrices !== undefined) {
      const ibm = isIndex(skin.inverseBindMatrices) ? accessors[skin.inverseBindMatrices] : undefined;
      if (ibm === undefined) {
        issues.error('malformed-gltf', `skins[${s}].inverseBindMatrices does not exist`, `${at}/inverseBindMatrices`);
      } else if (ibm.type !== 'MAT4' || ibm.count < joints.length) {
        issues.error(
          'malformed-gltf',
          `skins[${s}].inverseBindMatrices must be MAT4 with one matrix per joint`,
          `${at}/inverseBindMatrices`,
        );
      }
    }
  });
}

function checkAnimations(json: JsonRecord, nodeCount: number, issues: Issues): void {
  const accessors = accessorsOf(json);
  animationsOf(json).forEach((animation, a) => {
    const at = pointer('animations', a);
    const samplers = listField(animation.samplers);
    const channels = listField(animation.channels);
    samplers.forEach((sampler, s) => {
      const sat = `${at}/samplers/${s}`;
      const input = isIndex(sampler.input) ? accessors[sampler.input] : undefined;
      const output = isIndex(sampler.output) ? accessors[sampler.output] : undefined;
      if (input === undefined || output === undefined) {
        issues.error('malformed-gltf', `animations[${a}].samplers[${s}] references a missing accessor`, sat);
        return;
      }
      const interpolation = sampler.interpolation ?? 'LINEAR';
      if (!INTERPOLATIONS.has(interpolation)) {
        issues.error(
          'malformed-gltf',
          `animations[${a}].samplers[${s}] has unknown interpolation ${String(interpolation)}`,
          `${sat}/interpolation`,
        );
        return;
      }
      if (input.type !== 'SCALAR') {
        issues.error('malformed-gltf', `animations[${a}].samplers[${s}].input is not SCALAR`, `${sat}/input`);
      }
      // Morph weights hold N values per key, so the output count is a multiple of the key count.
      const keys = interpolation === 'CUBICSPLINE' ? input.count * 3 : input.count;
      const consistent = keys === 0 ? output.count === 0 : output.count % keys === 0;
      if (isIndex(input.count) && isIndex(output.count) && !consistent) {
        issues.error('malformed-gltf', `animations[${a}].samplers[${s}] output count does not match its input`, sat);
      }
    });
    channels.forEach((channel, ch) => {
      const cat = `${at}/channels/${ch}`;
      if (!isIndex(channel.sampler) || channel.sampler >= samplers.length) {
        issues.error(
          'malformed-gltf',
          `animations[${a}].channels[${ch}] references a missing sampler`,
          `${cat}/sampler`,
        );
      }
      const node = isRecord(channel.target) ? channel.target.node : undefined;
      if (node !== undefined && (!isIndex(node) || node >= nodeCount)) {
        issues.error('malformed-gltf', `animations[${a}].channels[${ch}] targets a missing node`, `${cat}/target/node`);
      }
    });
  });
}

function listLength(json: JsonRecord, key: string): number {
  const value = json[key];
  return Array.isArray(value) ? value.length : 0;
}
