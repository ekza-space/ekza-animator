// `README.txt` of the OMOBA local test kit (AUTORIG-SPEC §5.6.4; D6): what the files are, OMOBA's own runtime check
// (`validate-runtime-vrm`, omoba-bevy `docs/humanoid-motion.md`), where OMOBA's local flow reads the files
// (`<asset root>/avatars/<slug>.glb`, `OMOBA_AVATAR_MANIFEST`) and that runtime compatibility is not approval.
import type { OmobaManifestEntry } from './manifest';

/** The validator command the README names (run inside an omoba-bevy checkout). */
export function omobaValidateCommand(file: string): string {
  return `cargo run --offline -p omoba-passport --bin validate-runtime-vrm -- ${file}`;
}

/**
 * The README of a kit (plain text, LF line ends, a final newline); `version` is the avatar file's VRM version, `turned`
 * whether the kit's file is the VRM 1.0 turned to rest facing −Z as OMOBA's local import stages it (P-4).
 */
export function omobaKitReadme(entry: OmobaManifestEntry, version: '0.x' | '1.0' = '1.0', turned = false): string {
  const { slug } = entry;
  const avatar = turned
    ? `  ${slug}.glb            the avatar: the exported VRM ${version} file staged as OMOBA’s local import does`
    : `  ${slug}.glb            the avatar: the exported VRM ${version} file, byte for byte (OMOBA stages VRM files as .glb)`;
  const files = [
    avatar,
    ...(turned
      ? [
          '                       (scripts/convert_vrm_to_glb.py): turned 180° to rest facing -Z like every avatar',
          '                       the game renders, recorded as asset.extras.omoba_rest_yaw180',
        ]
      : []),
    ...(entry.thumbnail === null ? [] : [`  ${entry.thumbnail}            its thumbnail`]),
    '  manifest-entry.json  one avatar entry in the field names of OMOBA’s avatar manifest',
  ];
  return [
    `${entry.display_name} — OMOBA local test kit`,
    `Made with Ekza Studio (Auto-Rig). Licence: ${entry.license}.`,
    '',
    'Files',
    ...files,
    '',
    '1. Check the avatar with OMOBA’s own runtime validator, inside an omoba-bevy checkout:',
    '',
    `     ${omobaValidateCommand(`/absolute/path/to/${slug}.glb`)}`,
    '',
    `   It prints "Compatible local humanoid: VRM ${version} …" or names the rule the file breaks.`,
    '',
    `2. Copy ${slug}.glb${entry.thumbnail === null ? '' : ` and ${entry.thumbnail}`} into the avatars folder of OMOBA’s asset`,
    '   root (client/assets/avatars/ in a checkout, or <OMOBA_ASSET_DIR>/avatars/).',
    '',
    '3. Add the object in manifest-entry.json to the "avatars" list of a copy of avatars/manifest.json and start',
    '   both the server and the client with OMOBA_AVATAR_MANIFEST=/absolute/path/to/that/manifest.json',
    '   (client and server must read the same file).',
    '',
    'Runtime compatibility is not approval: passing the validator means OMOBA can load and animate this file on your',
    'machine. It grants no project approval, ownership or paid-avatar ticket. To use the avatar in OMOBA online, upload',
    'the .vrm to Ekza Hub.',
    '',
  ].join('\n');
}
