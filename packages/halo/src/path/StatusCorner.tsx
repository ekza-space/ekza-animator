// The status corner (STUDIO-TOUCH-SPEC §4.1, §4.8, §7.2; T6b): above the View puck, shown only when there is something
// to say — the problem count for the current destination (`● 2 to fix ▸`, the *total* of the one readiness list,
// never a per-stage filter and never "All good" while a row exists) and, when the destination has a triangle budget,
// the budget ring (`812 / 3,000`). The Next chip sits above the tray (`nextChip.ts`); the frame places both.
import { Cluster, TouchButton } from '@ekza-studio/ui/touch';
import type { JSX } from 'react';
import type { NextChip } from './nextChip';
import { type Readiness, statusText } from './readiness';

export interface StatusCornerProps {
  readonly readiness: Readiness;
  readonly onOpenHealth: () => void;
  readonly className?: string;
}

const formatCount = (n: number): string => n.toLocaleString('en-US');

/** The budget ring's fraction (0–1, over 1 when over budget). */
export function budgetFraction(budget: NonNullable<Readiness['budget']>): number {
  return budget.limit <= 0 ? 0 : budget.tris / budget.limit;
}

export function StatusCorner({ readiness, onOpenHealth, className }: StatusCornerProps): JSX.Element | null {
  const text = statusText(readiness);
  const budget = readiness.budget;
  if (text === null && budget === null) return null;
  return (
    <Cluster className={className ?? 'flex items-center gap-1 p-1'} data-testid="halo-status-corner">
      {text === null ? null : (
        <TouchButton
          variant="ghost"
          className="text-fg"
          data-testid="halo-status-pill"
          aria-label={`${readiness.total} to fix for ${readiness.destination.name}`}
          onClick={onOpenHealth}
        >
          <span aria-hidden="true" className="text-warn">
            ●
          </span>
          {text} ▸
        </TouchButton>
      )}
      {budget === null ? null : (
        <span
          data-testid="halo-budget-ring"
          className={`inline-flex min-h-(--touch-hit) items-center px-3 text-touch-label ${
            budgetFraction(budget) > 1 ? 'text-danger' : 'text-fg-2'
          }`}
        >
          {formatCount(budget.tris)} / {formatCount(budget.limit)}
          <span className="sr-only"> triangles</span>
        </span>
      )}
    </Cluster>
  );
}

export interface NextChipViewProps {
  readonly chip: NextChip | null;
  readonly onChip: (chip: NextChip) => void;
  readonly onDismiss: () => void;
}

/** The one Next chip (§7.2): dismissible; the frame hides it while a card or sheet is open. */
export function NextChipView({ chip, onChip, onDismiss }: NextChipViewProps): JSX.Element | null {
  if (chip === null) return null;
  return (
    <Cluster className="flex items-center p-1" data-testid="halo-next-chip">
      <TouchButton variant="primary" onClick={() => onChip(chip)}>
        {chip.label}
      </TouchButton>
      <TouchButton variant="ghost" aria-label="Dismiss the suggestion" onClick={onDismiss}>
        ✕
      </TouchButton>
    </Cluster>
  );
}
