// `VRMC_vrm` 1.0 for glTF Transform (M6B-SPEC §5.22; C10): a root-level ExtensionProperty with the humanoid bone →
// Node map, the meta (plain JSON, written with a fixed key order) and the thumbnail as a Texture reference, so node and
// image indices are resolved by the writer. No firstPerson, lookAt, expressions, spring bones, node constraints or
// MToon (§5.22). Typed against `@pixiv/types-vrmc-vrm-1.0` (types only).
import type { VRMCVRM, Meta as VrmcMeta } from '@pixiv/types-vrmc-vrm-1.0';
import {
  Extension,
  ExtensionProperty,
  type IProperty,
  type Node,
  type Nullable,
  PropertyType,
  RefMap,
  type Texture,
  type WriterContext,
} from '@gltf-transform/core';
import { HUMAN_BONE_NAMES } from '@ekza-studio/rig';

export const VRMC_VRM = 'VRMC_vrm';
const BONE_ORDER = new Map<string, number>(HUMAN_BONE_NAMES.map((name, i) => [name, i]));

/** The meta without `thumbnailImage` (the writer resolves the texture's image index). */
export type VrmcMetaJson = Omit<VrmcMeta, 'thumbnailImage'>;

interface IVrmcVrm extends IProperty {
  specVersion: string;
  humanBones: RefMap<Node>;
  meta: VrmcMetaJson | null;
  thumbnail: Texture;
}

/** The `VRMC_vrm` root object. */
export class VrmcVrm extends ExtensionProperty<IVrmcVrm> {
  static override EXTENSION_NAME: typeof VRMC_VRM = VRMC_VRM;
  declare extensionName: typeof VRMC_VRM;
  declare propertyType: 'VrmcVrm';
  declare parentTypes: [PropertyType.ROOT];

  protected override init(): void {
    this.extensionName = VRMC_VRM;
    this.propertyType = 'VrmcVrm';
    this.parentTypes = [PropertyType.ROOT];
  }

  protected override getDefaults(): Nullable<IVrmcVrm> {
    return Object.assign(super.getDefaults(), {
      specVersion: '1.0',
      humanBones: new RefMap<Node>(),
      meta: null,
      thumbnail: null,
    });
  }

  getSpecVersion(): string {
    return this.get('specVersion');
  }

  setBone(name: string, node: Node | null): this {
    return this.setRefMap('humanBones', name, node);
  }

  getBone(name: string): Node | null {
    return this.getRefMap('humanBones', name);
  }

  /** Mapped bone names in VRM 1.0 humanoid order (unknown names last, alphabetically). */
  listBones(): string[] {
    return this.listRefMapKeys('humanBones').sort(
      (a, b) => (BONE_ORDER.get(a) ?? 1e9) - (BONE_ORDER.get(b) ?? 1e9) || (a < b ? -1 : a > b ? 1 : 0),
    );
  }

  getMeta(): VrmcMetaJson | null {
    return this.get('meta');
  }

  setMeta(meta: VrmcMetaJson | null): this {
    return this.set('meta', meta);
  }

  getThumbnail(): Texture | null {
    return this.getRef('thumbnail');
  }

  setThumbnail(texture: Texture | null): this {
    return this.setRef('thumbnail', texture);
  }
}

/** The `VRMC_vrm` extension (write only: the app reads VRM through its own readers and three-vrm). */
export class VRMCVrmExtension extends Extension {
  static override EXTENSION_NAME: typeof VRMC_VRM = VRMC_VRM;
  public override readonly extensionName: typeof VRMC_VRM = VRMC_VRM;

  createVrm(): VrmcVrm {
    return new VrmcVrm(this.document.getGraph());
  }

  read(): this {
    return this;
  }

  write(context: WriterContext): this {
    const vrm = this.document.getRoot().getExtension<VrmcVrm>(VRMC_VRM);
    if (vrm === null) return this;
    const humanBones: Record<string, { node: number }> = {};
    for (const name of vrm.listBones()) {
      const node = vrm.getBone(name);
      const index = node === null ? undefined : context.nodeIndexMap.get(node);
      if (index !== undefined) humanBones[name] = { node: index };
    }
    const def: Partial<VRMCVRM> & { specVersion: string } = {
      specVersion: vrm.getSpecVersion() as VRMCVRM['specVersion'],
      humanoid: { humanBones: humanBones },
    };
    const meta = vrm.getMeta();
    if (meta !== null) {
      const thumbnail = vrm.getThumbnail();
      const image = thumbnail === null ? undefined : context.imageIndexMap.get(thumbnail);
      def.meta = orderedMeta(meta, image) as unknown as VrmcMeta;
    }
    const json = context.jsonDoc.json;
    json.extensions ??= {};
    json.extensions[VRMC_VRM] = def;
    return this;
  }
}

/** The meta's keys in the schema's order (deterministic bytes); `thumbnailImage` after the contact fields. */
const META_ORDER = [
  'name',
  'version',
  'authors',
  'copyrightInformation',
  'contactInformation',
  'references',
  'thirdPartyLicenses',
  'thumbnailImage',
  'licenseUrl',
  'avatarPermission',
  'allowExcessivelyViolentUsage',
  'allowExcessivelySexualUsage',
  'commercialUsage',
  'allowPoliticalOrReligiousUsage',
  'allowAntisocialOrHateUsage',
  'creditNotation',
  'allowRedistribution',
  'modification',
  'otherLicenseUrl',
] as const;

function orderedMeta(meta: VrmcMetaJson, image: number | undefined): Record<string, unknown> {
  const source: Record<string, unknown> = { ...meta, ...(image === undefined ? {} : { thumbnailImage: image }) };
  const out: Record<string, unknown> = {};
  for (const key of META_ORDER) if (source[key] !== undefined) out[key] = source[key];
  return out;
}
