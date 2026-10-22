// M6b test API, C12 group (M6B-SPEC §4.8, §0.5): `library()` — the starter pack's clips with their state (`ok` false
// once a clip's served file failed its checksum) and the running preview. Null until the clip-library chunk is loaded
// and the manifest is in (the first call starts the manifest load; poll it).
import { libraryView, loadManifest } from '../../panels/clipLibrary/state';
import type { EkzaStudioTestApi } from '../types';
import type { M6bTestApiContext } from './support';

export type ClipLibraryTestApi = Pick<EkzaStudioTestApi, 'library'>;

export function clipLibraryTestApi(ctx: M6bTestApiContext): ClipLibraryTestApi {
  return {
    library() {
      ctx.sync();
      const app = ctx.shell.app;
      if (!app.library.loaded) return null;
      const view = libraryView(app);
      if (view.manifest === null) {
        loadManifest(app);
        return null;
      }
      const preview = app.library.service.preview;
      return {
        clips: view.manifest.clips.map((clip) => ({
          id: clip.id,
          label: clip.label,
          slot: clip.slot,
          ok: !view.failed.has(clip.id),
        })),
        preview:
          preview === null ? null : { character: preview.character, clip: preview.clip, seconds: preview.seconds },
      };
    },
  };
}
