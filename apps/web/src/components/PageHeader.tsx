import * as React from 'react';
import { cn } from '../lib/utils';

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
};

/**
 * The one page banner used by every console screen. The eyebrow carries the
 * workflow position, the title stays the stable H1 the tests and users know.
 */
export function PageHeader({ eyebrow, title, description, actions, meta, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-col gap-4 border-b border-slate-900/[0.07] pb-6 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 rounded-full bg-emerald-500/40 blur-[2px]" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          {eyebrow}
        </div>
        <h1 className="mt-2 text-[1.65rem] font-semibold leading-tight tracking-[-0.025em] text-slate-900">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-slate-500">{description}</p>
        ) : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
