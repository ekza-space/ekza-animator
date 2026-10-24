// Placeholder (T6b, being built): the Numbers sheet.
import type { JSX } from 'react';
import type { HaloSheetProps } from '../../manifest/sheets';
import { HaloSheet } from '../more/kit';

export default function NumbersSheet({ ctx }: HaloSheetProps): JSX.Element {
  return <HaloSheet ctx={ctx} id="numbers" title="Numbers" />;
}
