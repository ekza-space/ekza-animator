// Placeholder (T6b, being built): the Health sheet.
import type { JSX } from 'react';
import type { HaloSheetProps } from '../../manifest/sheets';
import { HaloSheet } from '../more/kit';

export default function HealthSheet({ ctx }: HaloSheetProps): JSX.Element {
  return <HaloSheet ctx={ctx} id="health" title="Health" />;
}
