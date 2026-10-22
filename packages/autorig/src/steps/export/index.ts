// ⑤ Export step (AUTORIG-SPEC §5.6; D0 stub, D6 owns it): the targets, the checklist with its rule-label table, the
// avatar metadata, the `export` slice and its reducers. D0 lands only the slice's default (the recommended target).
import type { AutoRigExportSlice } from '../../types';

export const EXPORT_SLICE: AutoRigExportSlice = { target: 'ekza-vrm', downloaded: false };
