import * as React from 'react';
import { cn } from '../../lib/utils';

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    // The height ceiling is what makes the sticky header meaningful: without a
    // bounded scroll box the container is as tall as the table and nothing sticks.
    <div className="max-h-[min(68vh,620px)] w-full overflow-auto rounded-xl border border-slate-900/[0.07] bg-white">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        '[&_tr]:border-b [&_tr]:border-slate-900/[0.06] [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50 [&_th]:shadow-[0_1px_0_rgba(15,23,42,0.06)]',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-slate-900/[0.05] transition-colors last:border-0 hover:bg-emerald-50/30',
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'h-9 px-3 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2.5 align-middle text-[13px]', className)} {...props} />;
}

export function TableCaption({ className, ...props }: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn('mt-4 text-sm text-slate-500', className)} {...props} />;
}
