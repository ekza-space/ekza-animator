// `app.capture` (M6A-SPEC §4.6, §5.10; one factory file per editor service, owned by B11 after B0a).
//
// The numeric capture window (`edit/capture.ts`). The composition root creates it before the app exists; the operator
// runner and the built-ins bind the app on first use (`bindCapture`).
import { createNumericCapture, type NumericCapture } from '../../edit/capture';

export function createCapture(): NumericCapture {
  return createNumericCapture();
}
