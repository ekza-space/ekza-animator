// Derived wizard progress (AUTORIG-SPEC §4.3; D3): moved to `editor-core/src/progress` (STUDIO-TOUCH-SPEC §20.3
// item 10; T5c), where Halo's readiness reads the same source. This module keeps the wizard's names: the subject rule
// and the profile are the flow's (`resolveAutoRigSubject`, `AUTORIG_FLOW_PROFILE`; ST-T5B-8), and the wizard words
// the blocked reasons with its frame strings. The checklist chunk (AR-D3-21) is editor-core's now.
import { autoRigProgressNow, autoRigProgressOf, type AutoRigProgressInput } from '@ekza-studio/editor-core';
import { messages } from '../i18n';
import type { AutoRigProgress, AutoRigProgressFn } from '../types';

export {
  AUTORIG_FLOW_PROFILE as AUTORIG_PROFILE,
  autoRigChecklistLoaded as checklistLoaded,
  autoRigLandingStep as landingStep,
  autoRigSubjectRows as subjectRows,
  loadAutoRigChecklist as loadChecklist,
  type ResolvedAutoRigSubject as ResolvedSubject,
  resolveAutoRigSubject as resolveSubject,
} from '@ekza-studio/editor-core';

export type ProgressInput = AutoRigProgressInput;

/** §4.3's table as a pure function of its inputs, in the wizard's words. */
export const progressOf = (input: ProgressInput): AutoRigProgress => autoRigProgressOf(input, messages().frame);

/**
 * `autoRigProgress(app, session)` (§4.3): reads the document, the Validation rows and the session. Until
 * `loadChecklist()` resolved, a subject character's skeleton and binding read as unknown.
 */
export const autoRigProgress: AutoRigProgressFn = (app, session) =>
  autoRigProgressNow(app, session.subject, session.animations.skipped, messages().frame);
