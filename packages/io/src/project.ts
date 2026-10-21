// `@ekza-studio/io/project` (M2A-SPEC §5.21.2, M-2 boundary 5): the `.ekzanim` archive code and fflate behind one
// subpath, so `editor-core` loads them with a dynamic `import('@ekza-studio/io/project')` on the first save or
// open only. The main entry keeps exporting the same names (headless tests and tooling use it).
export { readProjectArchive, writeProjectArchive, writeProjectJson } from './project/archive';
