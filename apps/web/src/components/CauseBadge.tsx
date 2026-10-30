import { Badge } from './ui/badge';
import type { UnmetDiagnosis } from '../lib/api';

const LABELS: Record<string, string> = {
  no_route: 'No lane',
  product_not_allowed: 'Product blocked',
  contingency_only: 'Contingency only',
  deadline_blocked: 'Deadline',
  no_inventory: 'No stock',
  inventory_short: 'Stock short',
  lane_capacity: 'Lane capacity',
  inventory_shared: 'Stock used',
  capacity_shared: 'Capacity used',
  combined: 'Combined limits',
};

export function causeLabel(cause?: string): string {
  if (!cause) return '—';
  return LABELS[cause] ?? cause.replace(/_/g, ' ');
}

export function CauseBadge({ diagnosis }: { diagnosis?: UnmetDiagnosis }) {
  if (!diagnosis) return <span className="text-xs text-slate-400">—</span>;

  const variant =
    diagnosis.cause === 'deadline_blocked' || diagnosis.cause === 'contingency_only'
      ? 'warning'
      : diagnosis.cause === 'no_route' ||
          diagnosis.cause === 'product_not_allowed' ||
          diagnosis.cause === 'no_inventory'
        ? 'destructive'
        : 'secondary';

  return (
    <span title={diagnosis.explanation} className="cursor-help">
      <Badge variant={variant}>{causeLabel(diagnosis.cause)}</Badge>
    </span>
  );
}
