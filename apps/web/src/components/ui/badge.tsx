import * as React from 'react';
import { cn } from '../../lib/utils';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive';

const variantMap: Record<BadgeVariant, string> = {
  default: 'bg-slate-900 text-white ring-1 ring-inset ring-white/10',
  secondary: 'bg-slate-900/[0.05] text-slate-600 ring-1 ring-inset ring-slate-900/[0.04]',
  outline: 'border border-slate-200 bg-white text-slate-600',
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15',
  warning: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20',
  destructive: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/15',
};

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-5',
        variantMap[variant],
        className,
      )}
      {...props}
    />
  );
}
