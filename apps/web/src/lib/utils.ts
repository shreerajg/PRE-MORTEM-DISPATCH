import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { StoredDisruption } from './api';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type SolverStatusTone = 'success' | 'warning' | 'destructive' | 'secondary';

/**
 * Map a backend solver status to a badge tone. A feasible plan with no unmet
 * demand is a complete answer, so it reads as success rather than a warning.
 */
export function solverStatusTone(status?: string | null, unmet?: number | null): SolverStatusTone {
  if (!status) return 'secondary';
  if (status === 'optimal') return 'success';
  if (status === 'feasible') return unmet != null && unmet > 1e-6 ? 'warning' : 'success';
  return 'destructive';
}

/** Human label for a stored disruption, including combined scenarios. */
export function disruptionLabel(disruption?: StoredDisruption | null): string {
  if (!disruption) return '—';
  if ('events' in disruption) {
    const count = disruption.events.length;
    return `${count} combined disruption${count === 1 ? '' : 's'}`;
  }
  return disruption.type.replace(/_/g, ' ');
}

/** Scenario name when one was given, otherwise a short id. */
export function scenarioTitle(scenario: { id: string; name?: string | null }): string {
  return scenario.name?.trim() || scenario.id.slice(0, 8);
}
