// The OMOBA local test kit (AUTORIG-SPEC §5.6.4, AR-D24; D6): io code, so `autorig.export` (editor-core, rig chunk)
// builds every target — the kit included — for Studio, the palette, scripts and the MCP bridge alike.
export {
  type OmobaKitInput,
  omobaKitFileName,
  omobaKitFiles,
  packOmobaKit,
  unzipFiles,
  type ZipEntry,
  zipFiles,
} from './kit';
export {
  OMOBA_KIT_COLLECTION,
  OMOBA_KIT_PREFIX,
  OMOBA_MANIFEST_FIELDS,
  OMOBA_PROTECTED_PREFIX,
  OMOBA_SLUG_FALLBACK,
  OMOBA_SLUG_MAX,
  type OmobaKitMeta,
  omobaKitSlug,
  omobaLicense,
  type OmobaManifestEntry,
  omobaManifestEntry,
  omobaManifestJson,
  omobaSlug,
} from './manifest';
export { OMOBA_FACING_MARKER, stageVrmForOmoba } from './facing';
export { type OmobaDevZipInput, omobaDevZipFileName, omobaDevZipReadme, packOmobaDevZip } from './devZip';
export { omobaKitReadme, omobaValidateCommand } from './readme';
export { type VrmThumbnail, vrmThumbnail } from './thumbnail';
