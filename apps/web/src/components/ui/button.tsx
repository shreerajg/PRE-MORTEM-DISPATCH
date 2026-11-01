import * as React from 'react';
import { cn } from '../../lib/utils';

type Variant = 'default' | 'outline' | 'ghost' | 'destructive';
type Size = 'sm' | 'default' | 'lg' | 'icon';

const variantClasses: Record<Variant, string> = {
  default:
    'bg-slate-900 text-white hover:bg-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_10px_24px_-16px_rgba(15,23,42,0.6)]',
  outline:
    'border border-slate-300/80 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50 shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
  ghost: 'text-slate-600 hover:bg-slate-900/[0.05] hover:text-slate-900',
  destructive: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  default: 'h-9 gap-2 px-4 text-[13px]',
  lg: 'h-10 gap-2 px-5 text-sm',
  icon: 'h-9 w-9',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex select-none items-center justify-center rounded-lg font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/10 active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
