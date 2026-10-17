// `VRMC_vrm_animation` for glTF Transform (ADR 0005 §8): a root-level ExtensionProperty holding the humanoid bone →
// Node map, so node indices are resolved by the writer. Expressions and lookAt are V1 and are not modelled.
import {
  Extension,
  ExtensionProperty,
  type IProperty,
  type Node,
  type Nullable,
  PropertyType,
  type ReaderContext,
  RefMap,
  type WriterContext,
} from '@gltf-transform/core';
import { HUMAN_BONE_NAMES } from '@ekza-animator/rig';

export const VRMC_VRM_ANIMATION = 'VRMC_vrm_animation';
const BONE_ORDER = new Map<string, number>(HUMAN_BONE_NAMES.map((name, i) => [name, i]));

interface IVrmAnimationHumanoid extends IProperty {
  specVersion: string;
  humanBones: RefMap<Node>;
}

/** The `VRMC_vrm_animation` root object: spec version and humanoid bone nodes. */
export class VrmAnimationHumanoid extends ExtensionProperty<IVrmAnimationHumanoid> {
  static override EXTENSION_NAME: typeof VRMC_VRM_ANIMATION = VRMC_VRM_ANIMATION;
  declare extensionName: typeof VRMC_VRM_ANIMATION;
  declare propertyType: 'VrmAnimationHumanoid';
  declare parentTypes: [PropertyType.ROOT];

  protected override init(): void {
    this.extensionName = VRMC_VRM_ANIMATION;
    this.propertyType = 'VrmAnimationHumanoid';
    this.parentTypes = [PropertyType.ROOT];
  }

  protected override getDefaults(): Nullable<IVrmAnimationHumanoid> {
    return Object.assign(super.getDefaults(), { specVersion: '1.0', humanBones: new RefMap<Node>() });
  }

  getSpecVersion(): string {
    return this.get('specVersion');
  }

  setSpecVersion(version: string): this {
    return this.set('specVersion', version);
  }

  getBone(name: string): Node | null {
    return this.getRefMap('humanBones', name);
  }

  setBone(name: string, node: Node | null): this {
    return this.setRefMap('humanBones', name, node);
  }

  /** Mapped bone names in VRM 1.0 humanoid order (unknown names last, alphabetically). */
  listBones(): string[] {
    return this.listRefMapKeys('humanBones').sort(
      (a, b) => (BONE_ORDER.get(a) ?? 1e9) - (BONE_ORDER.get(b) ?? 1e9) || (a < b ? -1 : a > b ? 1 : 0),
    );
  }
}

export class VRMCVrmAnimation extends Extension {
  static override EXTENSION_NAME: typeof VRMC_VRM_ANIMATION = VRMC_VRM_ANIMATION;
  public override readonly extensionName: typeof VRMC_VRM_ANIMATION = VRMC_VRM_ANIMATION;

  createHumanoid(): VrmAnimationHumanoid {
    return new VrmAnimationHumanoid(this.document.getGraph());
  }

  read(context: ReaderContext): this {
    const def = context.jsonDoc.json.extensions?.[VRMC_VRM_ANIMATION] as
      | { specVersion?: string; humanoid?: { humanBones?: Record<string, { node?: number }> } }
      | undefined;
    if (def === undefined) return this;
    const humanoid = this.createHumanoid().setSpecVersion(def.specVersion ?? '1.0');
    for (const [name, bone] of Object.entries(def.humanoid?.humanBones ?? {})) {
      const node = bone.node === undefined ? undefined : context.nodes[bone.node];
      if (node !== undefined) humanoid.setBone(name, node);
    }
    this.document.getRoot().setExtension(VRMC_VRM_ANIMATION, humanoid);
    return this;
  }

  write(context: WriterContext): this {
    const humanoid = this.document.getRoot().getExtension<VrmAnimationHumanoid>(VRMC_VRM_ANIMATION);
    if (humanoid === null) return this;
    const humanBones: Record<string, { node: number }> = {};
    for (const name of humanoid.listBones()) {
      const node = humanoid.getBone(name);
      const index = node === null ? undefined : context.nodeIndexMap.get(node);
      if (index !== undefined) humanBones[name] = { node: index };
    }
    const json = context.jsonDoc.json;
    json.extensions ??= {};
    json.extensions[VRMC_VRM_ANIMATION] = { specVersion: humanoid.getSpecVersion(), humanoid: { humanBones } };
    return this;
  }
}
