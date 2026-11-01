import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            'flex h-9 w-full appearance-none rounded-lg border border-slate-300/80 bg-white pl-3 pr-9 py-2 text-[13px] text-slate-900 shadow-[0_1px_2px_rgba(16,24,40,0.03)] transition-colors hover:border-slate-400/80 focus:border-emerald-500/70 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 disabled:pointer-events-none disabled:opacity-50',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      </div>
    );
  },
);
Select.displayName = 'Select';
