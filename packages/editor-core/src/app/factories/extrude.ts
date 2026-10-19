// `app.extrude` (M6A-SPEC §4.6, §5.8; one factory file per editor service, owned by B12b after B0a).
//
// The extrude session (`operators/builtin/extrudeSession.ts`): an eager shim over the lazy engine. The composition
// root creates it before the app exists; the operator runner binds the app on its first run (`bindExtrude`).
import { createExtrudeSession, type ExtrudeSessionShim } from '../../operators/builtin/extrudeSession';

export function createExtrude(): ExtrudeSessionShim {
  return createExtrudeSession();
}
