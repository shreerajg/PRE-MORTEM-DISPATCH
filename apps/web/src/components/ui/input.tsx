import * as React from 'react';
import { cn } from '../../lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-lg border border-slate-300/80 bg-white px-3 py-2 text-[13px] text-slate-900 shadow-[0_1px_2px_rgba(16,24,40,0.03)] transition-colors placeholder:text-slate-400 hover:border-slate-400/80 focus:border-emerald-500/70 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = 'Input';
