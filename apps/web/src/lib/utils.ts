import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
