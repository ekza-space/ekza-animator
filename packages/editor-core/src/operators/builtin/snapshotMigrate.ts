// doc's snapshot migrations and record repairs on their own: `file.recover` loads them in its `prepare` (already
// asynchronous: it reads the slot from storage), so they are not part of the editor's first route (§5.27). The
// project archive (`file.openProject`) has them in its own lazy chunk.
export { migrateSnapshot } from '@ekza-studio/doc';
