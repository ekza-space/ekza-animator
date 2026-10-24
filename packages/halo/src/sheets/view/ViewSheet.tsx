// Placeholder (T6b, being built): the View sheet.
import type { JSX } from 'react';
import type { HaloSheetProps } from '../../manifest/sheets';
import { HaloSheet } from '../more/kit';

export default function ViewSheet({ ctx }: HaloSheetProps): JSX.Element {
  return <HaloSheet ctx={ctx} id="view" title="View" />;
}
