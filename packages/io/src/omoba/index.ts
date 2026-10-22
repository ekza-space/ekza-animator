// The OMOBA local test kit (AUTORIG-SPEC §5.6.4, AR-D24; D6): io code, so `autorig.export` (editor-core, rig chunk)
// builds every target — the kit included — for Studio, the palette, scripts and the MCP bridge alike.
export {
  type OmobaKitInput,
  omobaKitFileName,
  omobaKitFiles,
  packOmobaKit,
  type ZipEntry,
  zipFiles,
} from './kit';
export {
  OMOBA_KIT_COLLECTION,
  OMOBA_MANIFEST_FIELDS,
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
export { omobaKitReadme, omobaValidateCommand } from './readme';
