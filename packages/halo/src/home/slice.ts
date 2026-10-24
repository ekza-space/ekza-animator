// T11's slice of the test API's `halo()` (STUDIO-TOUCH-SPEC §20.7: plain JSON): the Continue cards, this tab's resume
// record, the storage card and Share's prepared file.
import type { HaloController } from '../shell/controller';
import { readResume } from './resume';
import { homeServices } from './start';

function sessionStore(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function homeSlice(controller: HaloController): Record<string, unknown> {
  const services = homeServices(controller);
  const { app } = controller.ctx;
  const bake = services.share.baker?.get() ?? null;
  const record = readResume(sessionStore());
  return {
    continue: app.session.getState().recovery.map((slot) => slot.id),
    resume: record === null ? null : { slot: record.slot, frame: record.frame },
    restoring: services.resume.restoring(),
    storage: services.storage.get(),
    share:
      bake === null
        ? null
        : {
            status: bake.status,
            fileName: bake.fileName,
            bytes: bake.bytes,
            delivered: bake.delivered,
            reason: bake.reason,
            lints: bake.lints.map((lint) => `${lint.severity}:${lint.code}`),
          },
  };
}
