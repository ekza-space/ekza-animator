// The extrude session (M6A-SPEC §5.8; B12b). Its API is `app.extrude` (`app/factories/extrude.ts`); the session adds
// no operator ids of its own (`edit.undo`/`edit.redo` and `edit.adjustLast` step its args stack). B12b registers any
// session operators here.
import type { AnyOperator } from './define';

export const EXTRUDE_SESSION_OPERATORS: readonly AnyOperator[] = [];
