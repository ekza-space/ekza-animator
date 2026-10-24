// Placeholder (T6b, being built): the Help sheet.
import type { JSX } from 'react';
import type { HaloSheetProps } from '../../manifest/sheets';
import { HaloSheet } from '../more/kit';

export default function HelpSheet({ ctx }: HaloSheetProps): JSX.Element {
  return <HaloSheet ctx={ctx} id="help" title="Help" />;
}
