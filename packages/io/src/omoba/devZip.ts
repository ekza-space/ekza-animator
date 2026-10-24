// The OMOBA developer zip of a character package (CHARACTER-CONTRACT-SPEC §4.2, decision CC-24; C2): the local-test
// form of a hero package, for OMOBA's own tools. `<slug>-omoba-dev.zip` holds `<slug>.glb` (the package VRM staged as
// OMOBA's local import stages it: a VRM 1.0 turned to rest facing −Z, `stageVrmForOmoba`), `<slug>.png` (the thumbnail,
// when there is one), `animations/<slot>.vrma` (one per custom animation, named by its primary slot, for other tools),
// `manifest-entry.json` (OMOBA's avatar manifest entry, as the local test kit), `slot-map.json` (a copy of the
// package's `ekza_package_v1` manifest) and `README.txt`. Deterministic like the kit (`zipFiles`). It replaces the local
// test kit for characters bound to a contract target; the kit stays for the others.
import { packageManifestJson, type PackageManifest } from '../contract/packageManifest';
import { stageVrmForOmoba } from './facing';
import { zipFiles } from './kit';
import { type OmobaKitMeta, type OmobaManifestEntry, omobaManifestEntry, omobaManifestJson } from './manifest';
import { omobaValidateCommand } from './readme';

export interface OmobaDevZipInput {
  /** The package VRM bytes (with `asset.extras.ekza_package_v1`). */
  readonly vrm: Uint8Array;
  /** The package's manifest (written as `slot-map.json`). */
  readonly manifest: PackageManifest;
  /** One VRMA per custom animation: its primary slot and bytes. */
  readonly animations: readonly { readonly slot: string; readonly bytes: Uint8Array }[];
  readonly thumbnail: Uint8Array | null;
  readonly meta: OmobaKitMeta;
}

/** The zip name of a developer zip: `<slug>-omoba-dev.zip`. */
export function omobaDevZipFileName(meta: OmobaKitMeta): string {
  return `${omobaManifestEntry(meta, false).slug}-omoba-dev.zip`;
}

/** The README of a developer zip (plain text, LF line ends, a final newline). */
export function omobaDevZipReadme(
  entry: OmobaManifestEntry,
  manifest: PackageManifest,
  animations: readonly string[],
  turned: boolean,
): string {
  const { slug } = entry;
  const fills = Object.entries(manifest.slots);
  const custom = fills.filter(([, fill]) => fill.mode === 'custom').length;
  return [
    `${entry.display_name} — OMOBA hero package, developer zip`,
    `Made with Ekza Studio for ${manifest.target.id} (${manifest.target.requirementId}). Licence: ${entry.license}.`,
    `Contract ${manifest.contract.game} ${manifest.contract.revision}: ${custom} of ${fills.length} slots are yours,`,
    'the others play the game’s own animations.',
    '',
    'Files',
    `  ${slug}.glb            the package VRM with your animations (each named by its slot) and the slot map in`,
    '                       asset.extras.ekza_package_v1',
    ...(turned
      ? ['                       turned 180° to rest facing -Z as OMOBA’s local import does (omoba_rest_yaw180)']
      : []),
    ...(entry.thumbnail === null ? [] : [`  ${entry.thumbnail}            its thumbnail`]),
    ...animations.map((slot) => `  animations/${slot}.vrma`),
    '  manifest-entry.json  one avatar entry in the field names of OMOBA’s avatar manifest',
    '  slot-map.json        a copy of the package’s slot map (ekza_package_v1)',
    '',
    '1. Check the avatar and its animations with OMOBA’s validators, inside an omoba-bevy checkout:',
    '',
    `     ${omobaValidateCommand(`/absolute/path/to/${slug}.glb`)}`,
    `     cargo run --offline -p omoba-passport --bin validate-motion-pack -- /absolute/path/to/${slug}.glb`,
    '',
    `2. Copy ${slug}.glb${entry.thumbnail === null ? '' : ` and ${entry.thumbnail}`} into the avatars folder of OMOBA’s asset`,
    '   root (client/assets/avatars/ in a checkout, or <OMOBA_ASSET_DIR>/avatars/).',
    '',
    '3. Add the object in manifest-entry.json to the "avatars" list of a copy of avatars/manifest.json and start',
    '   both the server and the client with OMOBA_AVATAR_MANIFEST=/absolute/path/to/that/manifest.json.',
    '',
    'This zip is for local tests. To bring the character into OMOBA, submit the package (.vrm) to Ekza Hub.',
    '',
  ].join('\n');
}

/** Packs the developer zip (see the header). */
export function packOmobaDevZip(input: OmobaDevZipInput): Uint8Array {
  const entry = omobaManifestEntry(input.meta, input.thumbnail !== null);
  const text = new TextEncoder();
  const staged = stageVrmForOmoba(input.vrm);
  const slots = input.animations.map((animation) => animation.slot);
  return zipFiles([
    { path: `${entry.slug}.glb`, bytes: staged.bytes },
    ...(input.thumbnail === null || entry.thumbnail === null
      ? []
      : [{ path: entry.thumbnail, bytes: input.thumbnail, deflate: false }]),
    ...input.animations.map((animation) => ({ path: `animations/${animation.slot}.vrma`, bytes: animation.bytes })),
    { path: 'manifest-entry.json', bytes: text.encode(omobaManifestJson(entry)) },
    { path: 'slot-map.json', bytes: text.encode(`${JSON.stringify(packageManifestJson(input.manifest), null, 2)}\n`) },
    { path: 'README.txt', bytes: text.encode(omobaDevZipReadme(entry, input.manifest, slots, staged.turned)) },
  ]);
}
